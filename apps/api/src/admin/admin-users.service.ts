import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { COUNTRY_SCOPED_ROLES, SELF_REGISTRABLE_ROLES, type Permission, type Role } from '@iie/shared';
import { Database, DB } from '../db/db';
import { countries, permissions, rolePermissions, roles, sellerProfiles, userRoles, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { EVENTS } from '../email/notification.dispatcher';
import { SessionService } from '../auth/session.service';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request';
import type { Principal } from '../rbac/principal';

const SELF_REGISTRABLE = new Set<string>(SELF_REGISTRABLE_ROLES);

@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly sessions: SessionService,
  ) {}

  /** Lists users within the caller's scope for user.read.any (all countries, or only their own). */
  async list(
    principal: Principal,
    q: { status?: string; role?: Role; countryCode?: string; q?: string; page: number; pageSize: number },
  ) {
    const scope = principal.scopeOf('user.read.any');
    if (!scope) throw Errors.forbidden();
    const where = and(
      scope === 'ALL' ? undefined : inArray(users.countryId, [...scope]),
      q.status ? eq(users.status, q.status) : undefined,
      q.countryCode ? eq(countries.isoAlpha2, q.countryCode) : undefined,
      q.q ? or(ilike(users.email, `%${q.q}%`), ilike(users.firstName, `%${q.q}%`), ilike(users.lastName, `%${q.q}%`)) : undefined,
      q.role
        ? sql`exists (select 1 from ${userRoles} ur join ${roles} r on r.id = ur.role_id where ur.user_id = ${users.id} and r.key = ${q.role})`
        : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          status: users.status,
          emailVerified: sql<boolean>`${users.emailVerifiedAt} is not null`,
          country: countries.isoAlpha2,
          createdAt: users.createdAt,
          lastLoginAt: users.lastLoginAt,
        })
        .from(users)
        .innerJoin(countries, eq(countries.id, users.countryId))
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ count: sql<number>`count(*)::int` }).from(users).innerJoin(countries, eq(countries.id, users.countryId)).where(where),
    ]);
    const roleRows = rows.length
      ? await this.db
          .select({ userId: userRoles.userId, key: roles.key })
          .from(userRoles)
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(inArray(userRoles.userId, rows.map((r) => r.id)))
      : [];
    return {
      items: rows.map((r) => ({ ...r, roles: roleRows.filter((x) => x.userId === r.id).map((x) => x.key) })),
      total: total?.count ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async get(principal: Principal, userId: string) {
    const user = await this.loadInScope(principal, 'user.read.any', userId);
    const assignments = await this.db
      .select({ id: userRoles.id, role: roles.key, country: countries.isoAlpha2, createdAt: userRoles.createdAt })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(countries, eq(countries.id, userRoles.countryId))
      .where(eq(userRoles.userId, userId));
    const [seller] = await this.db
      .select({ id: sellerProfiles.id, status: sellerProfiles.status, legalName: sellerProfiles.legalName, category: sellerProfiles.category })
      .from(sellerProfiles)
      .where(eq(sellerProfiles.userId, userId));
    const { passwordHash: _p, ...safe } = user;
    return { user: safe, roles: assignments, sellerProfile: seller ?? null };
  }

  async suspend(principal: Principal, userId: string, reason: string, meta: RequestMeta) {
    if (userId === principal.userId) throw Errors.badRequest('CANNOT_SUSPEND_SELF', 'You cannot suspend your own account');
    const user = await this.loadInScope(principal, 'user.suspend', userId);
    await this.assertCanActOnStaff(principal, userId);
    if (user.status === 'SUSPENDED') return;
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ status: 'SUSPENDED', updatedAt: new Date() }).where(eq(users.id, userId));
      const revoked = await this.sessions.revokeAllForUser(tx, userId);
      await this.outbox.enqueue(tx, EVENTS.accountSuspended, { email: user.email, firstName: user.firstName });
      await this.audit.record(tx, meta, {
        action: 'user.suspended',
        entityType: 'user',
        entityId: userId,
        before: { status: user.status },
        after: { status: 'SUSPENDED', reason, sessionsRevoked: revoked },
      });
    });
  }

  async reactivate(principal: Principal, userId: string, reason: string, meta: RequestMeta) {
    const user = await this.loadInScope(principal, 'user.suspend', userId);
    await this.assertCanActOnStaff(principal, userId);
    if (user.status !== 'SUSPENDED') throw Errors.badRequest('NOT_SUSPENDED', 'Only suspended accounts can be reactivated');
    const next = !user.onboardingSubmittedAt ? 'DRAFT' : user.emailVerifiedAt ? 'ACTIVE' : 'PENDING_VERIFICATION';
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ status: next, updatedAt: new Date() }).where(eq(users.id, userId));
      await this.audit.record(tx, meta, {
        action: 'user.reactivated',
        entityType: 'user',
        entityId: userId,
        before: { status: user.status },
        after: { status: next, reason },
      });
    });
  }

  async grantRole(principal: Principal, userId: string, role: Role, countryCode: string | undefined, meta: RequestMeta) {
    this.assertRoleManager(principal, userId);
    const countryId = await this.resolveRoleCountry(role, countryCode);
    await this.loadUser(userId);
    const [roleRow] = await this.db.select().from(roles).where(eq(roles.key, role));
    if (!roleRow) throw Errors.notFound('Role');
    await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(userRoles)
        .values({ userId, roleId: roleRow.id, countryId, grantedBy: principal.userId })
        .onConflictDoNothing()
        .returning();
      if (!created) throw Errors.conflict('ROLE_ALREADY_GRANTED', 'The user already has this role');
      await this.audit.record(tx, meta, {
        action: 'user.role_granted',
        entityType: 'user',
        entityId: userId,
        after: { assignmentId: created.id, role, country: countryCode ?? null },
      });
    });
  }

  async revokeRole(principal: Principal, userId: string, assignmentId: string, meta: RequestMeta) {
    this.assertRoleManager(principal, userId);
    await this.db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(userRoles)
        .where(and(eq(userRoles.id, assignmentId), eq(userRoles.userId, userId)))
        .returning();
      if (!removed) throw Errors.notFound('Role assignment');
      await this.audit.record(tx, meta, {
        action: 'user.role_revoked',
        entityType: 'user',
        entityId: userId,
        before: { assignmentId, roleId: removed.roleId, countryId: removed.countryId },
      });
    });
  }

  async listRoles() {
    const rows = await this.db
      .select({ key: roles.key, name: roles.name, description: roles.description, permission: permissions.key })
      .from(roles)
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .orderBy(asc(roles.key), asc(permissions.key));
    const byRole = new Map<string, { key: string; name: string; description: string; permissions: string[] }>();
    for (const r of rows) {
      const entry = byRole.get(r.key) ?? { key: r.key, name: r.name, description: r.description, permissions: [] };
      if (r.permission) entry.permissions.push(r.permission);
      byRole.set(r.key, entry);
    }
    return [...byRole.values()];
  }

  // ------------------------------------------------------------------ helpers

  private async loadUser(userId: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw Errors.notFound('User');
    return user;
  }

  /** Loads a user and checks the permission covers that user's country. Out-of-scope users look like 404s. */
  private async loadInScope(principal: Principal, permission: Permission, userId: string) {
    const user = await this.loadUser(userId);
    if (!principal.canInCountry(permission, user.countryId)) throw Errors.notFound('User');
    return user;
  }

  /** Only platform-wide role managers may act on accounts that hold operational (staff/partner) roles. */
  private async assertCanActOnStaff(principal: Principal, userId: string) {
    const held = await this.db
      .select({ key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, userId));
    if (held.some((r) => !SELF_REGISTRABLE.has(r.key)) && !principal.canGlobally('user.roles.manage')) {
      throw Errors.forbidden('Only platform administrators can change staff or partner accounts');
    }
  }

  private assertRoleManager(principal: Principal, userId: string) {
    if (!principal.canGlobally('user.roles.manage')) throw Errors.forbidden();
    if (userId === principal.userId) throw Errors.badRequest('CANNOT_CHANGE_OWN_ROLES', 'You cannot change your own roles');
  }

  private async resolveRoleCountry(role: Role, countryCode: string | undefined): Promise<string | null> {
    const scoped = (COUNTRY_SCOPED_ROLES as readonly string[]).includes(role);
    if (scoped && !countryCode) throw Errors.badRequest('COUNTRY_REQUIRED', `${role} must be limited to a country`);
    if (!scoped && countryCode) throw Errors.badRequest('COUNTRY_NOT_ALLOWED', `${role} cannot be limited to a country`);
    if (!countryCode) return null;
    const [country] = await this.db.select({ id: countries.id }).from(countries).where(eq(countries.isoAlpha2, countryCode));
    if (!country) throw Errors.notFound('Country');
    return country.id;
  }
}
