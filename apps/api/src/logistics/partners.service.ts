import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, asc, eq, inArray } from 'drizzle-orm';
import type { PartnerKind, Role } from '@iie/shared';
import { Database, DB, Tx } from '../db/db';
import { countries, lanes, partnerLanes, partnerMembers, roles, servicePartners, userRoles, users } from '../db/schema';
import { Errors } from '../common/errors';
import { randomToken } from '../common/crypto';
import type { RequestMeta } from '../common/request';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { hashPassword } from '../auth/passwords';
import { EVENTS } from '../email/notification.dispatcher';
import { OutboxService } from '../outbox/outbox.service';
import { RbacService } from '../rbac/rbac.service';
import type { Principal } from '../rbac/principal';

/** The role a partner's staff hold; what they can reach is then limited by membership. */
export const ROLE_FOR_KIND: Record<PartnerKind, Role> = { LOGISTICS: 'logistics_partner', CUSTOMS_BROKER: 'customs_broker' };

type PartnerRow = typeof servicePartners.$inferSelect;

/**
 * Logistics partners and customs brokers, their lanes and their staff. Administered by IIE (`partner.manage`).
 * No company is hard-coded: shipments are assigned to whichever active partner serves the lane.
 */
@Injectable()
export class PartnersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
  ) {}

  async list() {
    const rows = await this.db
      .select({ p: servicePartners, country: countries.isoAlpha2, countryName: countries.name })
      .from(servicePartners)
      .innerJoin(countries, eq(countries.id, servicePartners.countryId))
      .orderBy(asc(servicePartners.kind), asc(servicePartners.name));
    const ids = rows.map((r) => r.p.id);
    const origin = aliasedTable(countries, 'origin');
    const destination = aliasedTable(countries, 'destination');
    const laneRows = ids.length
      ? await this.db
          .select({ partnerId: partnerLanes.partnerId, laneId: lanes.id, origin: origin.isoAlpha2, destination: destination.isoAlpha2, active: partnerLanes.active })
          .from(partnerLanes)
          .innerJoin(lanes, eq(lanes.id, partnerLanes.laneId))
          .innerJoin(origin, eq(origin.id, lanes.originCountryId))
          .innerJoin(destination, eq(destination.id, lanes.destinationCountryId))
          .where(inArray(partnerLanes.partnerId, ids))
      : [];
    const memberRows = ids.length
      ? await this.db
          .select({ partnerId: partnerMembers.partnerId, userId: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName, verified: users.emailVerifiedAt })
          .from(partnerMembers)
          .innerJoin(users, eq(users.id, partnerMembers.userId))
          .where(inArray(partnerMembers.partnerId, ids))
      : [];
    return {
      items: rows.map((r) => ({
        ...this.view(r.p, r.country, r.countryName),
        lanes: laneRows.filter((l) => l.partnerId === r.p.id).map(({ partnerId: _, ...l }) => l),
        members: memberRows
          .filter((m) => m.partnerId === r.p.id)
          .map((m) => ({ userId: m.userId, email: m.email, name: `${m.firstName} ${m.lastName}`, invitationAccepted: !!m.verified })),
      })),
    };
  }

  async create(input: { kind: PartnerKind; name: string; countryCode: string; contactEmail: string; contactPhone: string; clearsCustoms: boolean }, meta: RequestMeta) {
    const country = await this.country(input.countryCode);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(servicePartners)
        .values({
          kind: input.kind,
          name: input.name,
          countryId: country.id,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
          // Brokers are the customs party by definition; the flag only describes carriers.
          clearsCustoms: input.kind === 'LOGISTICS' ? input.clearsCustoms : false,
        })
        .returning();
      await this.audit.record(tx, meta, { action: 'partner.created', entityType: 'service_partner', entityId: row!.id, after: input });
      return this.view(row!, country.isoAlpha2, country.name);
    });
  }

  async update(id: string, input: Partial<{ name: string; contactEmail: string; contactPhone: string; clearsCustoms: boolean; active: boolean }>, meta: RequestMeta) {
    const before = await this.load(id);
    await this.db.transaction(async (tx) => {
      await tx
        .update(servicePartners)
        .set({ ...input, ...(before.kind === 'CUSTOMS_BROKER' ? { clearsCustoms: false } : {}), updatedAt: new Date() })
        .where(eq(servicePartners.id, id));
      await this.audit.record(tx, meta, { action: 'partner.updated', entityType: 'service_partner', entityId: id, before, after: input });
    });
  }

  async addLane(id: string, origin: string, destination: string, meta: RequestMeta) {
    const partner = await this.load(id);
    if (partner.kind !== 'LOGISTICS') throw Errors.badRequest('NOT_A_CARRIER', 'Only logistics partners serve trade lanes. A customs broker covers its own country.');
    const lane = await this.lane(origin, destination);
    await this.db.transaction(async (tx) => {
      const [row] = await tx.insert(partnerLanes).values({ partnerId: id, laneId: lane.id }).onConflictDoNothing().returning();
      if (!row) await tx.update(partnerLanes).set({ active: true }).where(and(eq(partnerLanes.partnerId, id), eq(partnerLanes.laneId, lane.id)));
      await this.audit.record(tx, meta, { action: 'partner.lane_added', entityType: 'service_partner', entityId: id, after: { origin, destination } });
    });
  }

  async removeLane(id: string, laneId: string, meta: RequestMeta) {
    await this.load(id);
    await this.db.transaction(async (tx) => {
      const [row] = await tx.update(partnerLanes).set({ active: false }).where(and(eq(partnerLanes.partnerId, id), eq(partnerLanes.laneId, laneId))).returning();
      if (!row) throw Errors.notFound('Lane');
      await this.audit.record(tx, meta, { action: 'partner.lane_removed', entityType: 'service_partner', entityId: id, after: { laneId } });
    });
  }

  /**
   * Adds a staff member. An existing IIE account is added as is; otherwise an account is created in the partner's
   * country and the person is emailed a link to choose a password (which also verifies their email).
   */
  async inviteMember(principal: Principal, id: string, input: { email: string; firstName: string; lastName: string }, meta: RequestMeta) {
    const partner = await this.load(id);
    const unusablePassword = await hashPassword(randomToken());
    return this.db.transaction(async (tx) => {
      let [user] = await tx.select().from(users).where(eq(users.email, input.email));
      const created = !user;
      if (!user) {
        [user] = await tx
          .insert(users)
          .values({ email: input.email, passwordHash: unusablePassword, firstName: input.firstName, lastName: input.lastName, countryId: partner.countryId, status: 'ACTIVE' })
          .returning();
      }
      const [member] = await tx.insert(partnerMembers).values({ partnerId: id, userId: user!.id, addedBy: principal.userId }).onConflictDoNothing().returning();
      if (!member) throw Errors.conflict('ALREADY_A_MEMBER', `${input.email} is already on ${partner.name}'s team`);
      await this.grantRole(tx, user!.id, ROLE_FOR_KIND[partner.kind as PartnerKind], principal.userId);
      if (created) {
        const token = await this.auth.issueInviteToken(tx, user!.id);
        await this.outbox.enqueue(tx, EVENTS.partnerInvited, { email: user!.email, firstName: user!.firstName, partnerName: partner.name, token });
      } else {
        await this.outbox.enqueue(tx, EVENTS.partnerMemberAdded, { email: user!.email, firstName: user!.firstName, partnerName: partner.name });
      }
      await this.audit.record(tx, meta, { action: 'partner.member_added', entityType: 'service_partner', entityId: id, after: { userId: user!.id, email: user!.email, newAccount: created } });
      return { userId: user!.id, newAccount: created };
    });
  }

  /** Removes a staff member. Their partner role is revoked when they no longer belong to any partner of that kind. */
  async removeMember(id: string, userId: string, meta: RequestMeta) {
    const partner = await this.load(id);
    await this.db.transaction(async (tx) => {
      const [removed] = await tx.delete(partnerMembers).where(and(eq(partnerMembers.partnerId, id), eq(partnerMembers.userId, userId))).returning();
      if (!removed) throw Errors.notFound('Team member');
      const others = await tx
        .select({ id: partnerMembers.id })
        .from(partnerMembers)
        .innerJoin(servicePartners, eq(servicePartners.id, partnerMembers.partnerId))
        .where(and(eq(partnerMembers.userId, userId), eq(servicePartners.kind, partner.kind)));
      if (!others.length) {
        const roleId = await this.rbac.roleIdByKey(ROLE_FOR_KIND[partner.kind as PartnerKind], tx);
        await tx.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));
      }
      await this.audit.record(tx, meta, { action: 'partner.member_removed', entityType: 'service_partner', entityId: id, after: { userId, roleRevoked: !others.length } });
    });
  }

  // ------------------------------------------------------------------ helpers

  async load(id: string): Promise<PartnerRow> {
    const [row] = await this.db.select().from(servicePartners).where(eq(servicePartners.id, id));
    if (!row) throw Errors.notFound('Partner');
    return row;
  }

  private async grantRole(tx: Tx, userId: string, role: Role, grantedBy: string) {
    const [roleRow] = await tx.select().from(roles).where(eq(roles.key, role));
    await tx.insert(userRoles).values({ userId, roleId: roleRow!.id, countryId: null, grantedBy }).onConflictDoNothing();
  }

  private async country(code: string) {
    const [row] = await this.db.select().from(countries).where(eq(countries.isoAlpha2, code));
    if (!row) throw Errors.badRequest('UNKNOWN_COUNTRY', `Unknown country ${code}`);
    return row;
  }

  private async lane(origin: string, destination: string) {
    const o = await this.country(origin);
    const d = await this.country(destination);
    const [row] = await this.db.select().from(lanes).where(and(eq(lanes.originCountryId, o.id), eq(lanes.destinationCountryId, d.id)));
    if (!row) throw Errors.badRequest('UNKNOWN_LANE', `There is no ${origin} → ${destination} trade lane. Add it under Countries first.`);
    return row;
  }

  private view(p: PartnerRow, country: string, countryName: string) {
    return {
      id: p.id,
      kind: p.kind,
      name: p.name,
      country,
      countryName,
      contactEmail: p.contactEmail,
      contactPhone: p.contactPhone,
      clearsCustoms: p.clearsCustoms,
      active: p.active,
    };
  }
}
