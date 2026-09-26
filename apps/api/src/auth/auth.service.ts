import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { authenticator } from 'otplib';
import type { AccountStatus, LoginInput, RegisterInput, Role } from '@iie/shared';
import { SIGN_IN_ALLOWED_STATUSES } from '@iie/shared';
import { APP_CONFIG, AppConfig } from '../config/config';
import { Database, DB, Tx } from '../db/db';
import { countries, mfaFactors, userRoles, users, verificationTokens } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { EVENTS } from '../email/notification.dispatcher';
import { decryptSecret, encryptSecret, randomToken, sha256Hex } from '../common/crypto';
import { AppError, Errors } from '../common/errors';
import { RequestMeta, requestMeta } from '../common/request';
import { RbacService } from '../rbac/rbac.service';
import type { Principal } from '../rbac/principal';
import { AccountLifecycleService } from '../users/account-lifecycle.service';
import { dummyPasswordHash, hashPassword, verifyPassword } from './passwords';
import { SessionService } from './session.service';

export const MAX_FAILED_LOGINS = 10;
export const LOCKOUT_MINUTES = 15;
const EMAIL_TOKEN_HOURS = 24;
const RESET_TOKEN_HOURS = 1;

type TokenPurpose = 'EMAIL_VERIFY' | 'PASSWORD_RESET';

const ROLES_FOR_ACCOUNT_TYPE: Record<RegisterInput['accountType'], Role[]> = {
  BUYER: ['buyer'],
  SELLER: ['seller'],
  BUYER_SELLER: ['buyer', 'seller'],
};

const invalidCredentials = () => new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Email or password is incorrect');

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
    private readonly lifecycle: AccountLifecycleService,
  ) {}

  /**
   * Always answers the same way whether or not the email is taken, so the endpoint cannot be used to
   * discover who has an account. The existing owner gets an email instead.
   */
  async register(input: RegisterInput, meta: RequestMeta): Promise<void> {
    const [country] = await this.db.select().from(countries).where(eq(countries.isoAlpha2, input.countryCode));
    if (!country) throw Errors.badRequest('UNKNOWN_COUNTRY', 'Choose a country from the list');
    if (!country.marketplaceEnabled) {
      throw Errors.badRequest('COUNTRY_NOT_AVAILABLE', `IIE is not yet open in ${country.name}`);
    }
    const passwordHash = await hashPassword(input.password);

    await this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(users).where(eq(users.email, input.email));
      if (existing) {
        await this.outbox.enqueue(tx, EVENTS.registrationAttempted, { email: existing.email, firstName: existing.firstName });
        return;
      }
      const [user] = await tx
        .insert(users)
        .values({ email: input.email, passwordHash, firstName: input.firstName, lastName: input.lastName, countryId: country.id })
        .returning();
      for (const role of ROLES_FOR_ACCOUNT_TYPE[input.accountType]) {
        await tx.insert(userRoles).values({ userId: user!.id, roleId: await this.rbac.roleIdByKey(role, tx) });
      }
      const token = await this.issueToken(tx, user!.id, 'EMAIL_VERIFY', EMAIL_TOKEN_HOURS);
      await this.outbox.enqueue(tx, EVENTS.emailVerificationRequested, { email: user!.email, firstName: user!.firstName, token });
      await this.audit.record(tx, { ...meta, actorUserId: user!.id }, {
        action: 'user.registered',
        entityType: 'user',
        entityId: user!.id,
        after: { email: user!.email, country: country.isoAlpha2, accountType: input.accountType, status: user!.status },
      });
    });
  }

  async verifyEmail(token: string, meta: RequestMeta): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await this.consumeToken(tx, token, 'EMAIL_VERIFY');
      const [user] = await tx.select().from(users).where(eq(users.id, row.userId));
      if (!user!.emailVerifiedAt) {
        await tx.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user!.id));
        await this.audit.record(tx, { ...meta, actorUserId: user!.id }, { action: 'user.email_verified', entityType: 'user', entityId: user!.id });
      }
      await this.lifecycle.advance(tx, user!.id, { ...meta, actorUserId: user!.id });
    });
  }

  async resendVerification(principal: Principal): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, principal.userId));
      if (!user || user.emailVerifiedAt) return;
      const token = await this.issueToken(tx, user.id, 'EMAIL_VERIFY', EMAIL_TOKEN_HOURS);
      await this.outbox.enqueue(tx, EVENTS.emailVerificationRequested, { email: user.email, firstName: user.firstName, token });
    });
  }

  async login(input: LoginInput, req: Request, res: Response) {
    const meta = requestMeta(req);
    const [user] = await this.db.select().from(users).where(eq(users.email, input.email));
    if (!user) {
      await verifyPassword(await dummyPasswordHash(), input.password);
      throw invalidCredentials();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.db.transaction((tx) =>
        this.audit.record(tx, { ...meta }, { action: 'auth.login_blocked_locked', entityType: 'user', entityId: user.id }),
      );
      throw new AppError(HttpStatus.UNAUTHORIZED, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes or reset your password.`);
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      await this.recordFailedLogin(user.id, meta, 'password');
      throw invalidCredentials();
    }
    if (!SIGN_IN_ALLOWED_STATUSES.includes(user.status as AccountStatus)) {
      await this.db.transaction((tx) =>
        this.audit.record(tx, meta, { action: 'auth.login_denied_status', entityType: 'user', entityId: user.id, after: { status: user.status } }),
      );
      throw new AppError(HttpStatus.FORBIDDEN, 'ACCOUNT_UNAVAILABLE', 'This account cannot sign in. Contact support for help.');
    }

    const [factor] = await this.db.select().from(mfaFactors).where(eq(mfaFactors.userId, user.id));
    if (factor?.confirmedAt) {
      if (!input.totpCode) throw new AppError(HttpStatus.UNAUTHORIZED, 'MFA_REQUIRED', 'Enter the 6-digit code from your authenticator app');
      if (!authenticator.check(input.totpCode, decryptSecret(factor.secretEncrypted, this.config.MFA_ENCRYPTION_KEY))) {
        await this.recordFailedLogin(user.id, meta, 'mfa');
        throw new AppError(HttpStatus.UNAUTHORIZED, 'MFA_INVALID', 'That code is not valid. Try the latest code.');
      }
    }

    const session = await this.db.transaction(async (tx) => {
      await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
      const created = await this.sessions.create(tx, user.id, req);
      await this.audit.record(tx, { ...meta, actorUserId: user.id, sessionId: created.id }, {
        action: 'auth.login',
        entityType: 'session',
        entityId: created.id,
        after: { mfa: !!factor?.confirmedAt },
      });
      return created;
    });
    this.sessions.setCookies(res, session.token, session.csrfToken, session.expiresAt);
    return { csrfToken: session.csrfToken };
  }

  async logout(principal: Principal, req: Request, res: Response): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.sessions.revoke(tx, principal.sessionId);
      await this.audit.record(tx, requestMeta(req), { action: 'auth.logout', entityType: 'session', entityId: principal.sessionId });
    });
    this.sessions.clearCookies(res);
  }

  /** Always succeeds from the caller's point of view. */
  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.email, email));
      if (!user || !SIGN_IN_ALLOWED_STATUSES.includes(user.status as AccountStatus)) return;
      const token = await this.issueToken(tx, user.id, 'PASSWORD_RESET', RESET_TOKEN_HOURS);
      await this.outbox.enqueue(tx, EVENTS.passwordResetRequested, { email: user.email, firstName: user.firstName, token });
      await this.audit.record(tx, meta, { action: 'auth.password_reset_requested', entityType: 'user', entityId: user.id });
    });
  }

  async resetPassword(token: string, password: string, meta: RequestMeta): Promise<void> {
    const passwordHash = await hashPassword(password);
    await this.db.transaction(async (tx) => {
      const row = await this.consumeToken(tx, token, 'PASSWORD_RESET');
      const [user] = await tx
        .update(users)
        .set({ passwordHash, failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
        .where(eq(users.id, row.userId))
        .returning();
      const revoked = await this.sessions.revokeAllForUser(tx, user!.id);
      await this.outbox.enqueue(tx, EVENTS.passwordChanged, { email: user!.email, firstName: user!.firstName });
      await this.audit.record(tx, { ...meta, actorUserId: user!.id }, {
        action: 'auth.password_reset',
        entityType: 'user',
        entityId: user!.id,
        after: { sessionsRevoked: revoked },
      });
    });
  }

  async changePassword(principal: Principal, currentPassword: string, newPassword: string, meta: RequestMeta): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.id, principal.userId));
    if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'INVALID_CURRENT_PASSWORD', 'Your current password is incorrect');
    }
    const passwordHash = await hashPassword(newPassword);
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id));
      const revoked = await this.sessions.revokeAllForUser(tx, user.id, principal.sessionId);
      await this.outbox.enqueue(tx, EVENTS.passwordChanged, { email: user.email, firstName: user.firstName });
      await this.audit.record(tx, meta, { action: 'auth.password_changed', entityType: 'user', entityId: user.id, after: { otherSessionsRevoked: revoked } });
    });
  }

  async revokeSession(principal: Principal, sessionId: string, meta: RequestMeta): Promise<void> {
    const mine = await this.sessions.listForUser(principal.userId);
    if (!mine.some((s) => s.id === sessionId)) throw Errors.notFound('Session');
    await this.db.transaction(async (tx) => {
      await this.sessions.revoke(tx, sessionId);
      await this.audit.record(tx, meta, { action: 'auth.session_revoked', entityType: 'session', entityId: sessionId });
    });
  }

  // ------------------------------------------------------------------ MFA (TOTP)

  async startTotpSetup(principal: Principal) {
    const [user] = await this.db.select().from(users).where(eq(users.id, principal.userId));
    const [existing] = await this.db.select().from(mfaFactors).where(eq(mfaFactors.userId, principal.userId));
    if (existing?.confirmedAt) throw Errors.conflict('MFA_ALREADY_ENABLED', 'Two-step verification is already on');
    const secret = authenticator.generateSecret();
    const secretEncrypted = encryptSecret(secret, this.config.MFA_ENCRYPTION_KEY);
    await this.db
      .insert(mfaFactors)
      .values({ userId: principal.userId, secretEncrypted })
      .onConflictDoUpdate({ target: mfaFactors.userId, set: { secretEncrypted, createdAt: new Date() } });
    return { secret, otpauthUrl: authenticator.keyuri(user!.email, 'Inter-Island Exchange', secret) };
  }

  async confirmTotp(principal: Principal, code: string, meta: RequestMeta): Promise<void> {
    const [factor] = await this.db.select().from(mfaFactors).where(eq(mfaFactors.userId, principal.userId));
    if (!factor) throw Errors.badRequest('MFA_NOT_STARTED', 'Start two-step verification setup first');
    if (factor.confirmedAt) throw Errors.conflict('MFA_ALREADY_ENABLED', 'Two-step verification is already on');
    if (!authenticator.check(code, decryptSecret(factor.secretEncrypted, this.config.MFA_ENCRYPTION_KEY))) {
      throw Errors.badRequest('MFA_INVALID', 'That code is not valid. Try the latest code.');
    }
    await this.db.transaction(async (tx) => {
      await tx.update(mfaFactors).set({ confirmedAt: new Date() }).where(eq(mfaFactors.id, factor.id));
      await this.audit.record(tx, meta, { action: 'auth.mfa_enabled', entityType: 'user', entityId: principal.userId });
    });
  }

  async disableTotp(principal: Principal, code: string, meta: RequestMeta): Promise<void> {
    const [factor] = await this.db.select().from(mfaFactors).where(eq(mfaFactors.userId, principal.userId));
    if (!factor?.confirmedAt) throw Errors.badRequest('MFA_NOT_ENABLED', 'Two-step verification is not on');
    if (!authenticator.check(code, decryptSecret(factor.secretEncrypted, this.config.MFA_ENCRYPTION_KEY))) {
      throw Errors.badRequest('MFA_INVALID', 'That code is not valid. Try the latest code.');
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(mfaFactors).where(eq(mfaFactors.id, factor.id));
      await this.audit.record(tx, meta, { action: 'auth.mfa_disabled', entityType: 'user', entityId: principal.userId });
    });
  }

  // ------------------------------------------------------------------ helpers

  private async recordFailedLogin(userId: string, meta: RequestMeta, reason: 'password' | 'mfa'): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(users)
        .set({
          failedLoginCount: sql`${users.failedLoginCount} + 1`,
          lockedUntil: sql`case when ${users.failedLoginCount} + 1 >= ${MAX_FAILED_LOGINS}
                            then now() + make_interval(mins => ${LOCKOUT_MINUTES}) else ${users.lockedUntil} end`,
        })
        .where(eq(users.id, userId))
        .returning({ failedLoginCount: users.failedLoginCount, lockedUntil: users.lockedUntil });
      await this.audit.record(tx, meta, {
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: userId,
        after: { reason, failedLoginCount: updated?.failedLoginCount, lockedUntil: updated?.lockedUntil },
      });
    });
  }

  /** Creates a single-use token, invalidating earlier unused tokens of the same purpose. Returns the raw token. */
  private async issueToken(tx: Tx, userId: string, purpose: TokenPurpose, ttlHours: number): Promise<string> {
    await tx
      .update(verificationTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(verificationTokens.userId, userId), eq(verificationTokens.purpose, purpose), isNull(verificationTokens.usedAt)));
    const token = randomToken();
    await tx.insert(verificationTokens).values({
      userId,
      purpose,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + ttlHours * 3600_000),
    });
    return token;
  }

  private async consumeToken(tx: Tx, token: string, purpose: TokenPurpose) {
    const [row] = await tx
      .update(verificationTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(verificationTokens.tokenHash, sha256Hex(token)),
          eq(verificationTokens.purpose, purpose),
          isNull(verificationTokens.usedAt),
          gt(verificationTokens.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!row) throw Errors.badRequest('INVALID_OR_EXPIRED_TOKEN', 'This link is invalid or has expired. Request a new one.');
    return row;
  }
}
