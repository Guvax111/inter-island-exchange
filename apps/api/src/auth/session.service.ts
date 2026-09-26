import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { APP_CONFIG, AppConfig } from '../config/config';
import { Database, DB, Tx } from '../db/db';
import { sessions } from '../db/schema';
import { randomToken, sha256Hex } from '../common/crypto';

export const SESSION_COOKIE = 'iie_session';
export const CSRF_COOKIE = 'iie_csrf';
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class SessionService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(tx: Tx, userId: string, req: Request) {
    const token = randomToken();
    const csrfToken = randomToken(24);
    const expiresAt = new Date(Date.now() + this.config.SESSION_ABSOLUTE_HOURS * 3600_000);
    const [session] = await tx
      .insert(sessions)
      .values({
        userId,
        tokenHash: sha256Hex(token),
        csrfToken,
        ip: req.ip ?? null,
        userAgent: req.header('user-agent')?.slice(0, 400) ?? null,
        expiresAt,
      })
      .returning({ id: sessions.id });
    return { id: session!.id, token, csrfToken, expiresAt };
  }

  /** Returns the live session for a cookie token, enforcing absolute and idle expiry. */
  async resolve(token: string) {
    const [session] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.tokenHash, sha256Hex(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));
    if (!session) return null;
    const idleCutoff = Date.now() - this.config.SESSION_IDLE_HOURS * 3600_000;
    if (session.lastSeenAt.getTime() < idleCutoff) {
      await this.revoke(this.db, session.id);
      return null;
    }
    if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, session.id));
    }
    return session;
  }

  async revoke(tx: Tx, sessionId: string): Promise<void> {
    await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  /** Revokes every live session for a user, optionally keeping one (the caller's). */
  async revokeAllForUser(tx: Tx, userId: string, exceptSessionId?: string): Promise<number> {
    const revoked = await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          exceptSessionId ? ne(sessions.id, exceptSessionId) : sql`true`,
        ),
      )
      .returning({ id: sessions.id });
    return revoked.length;
  }

  async listForUser(userId: string) {
    return this.db
      .select({
        id: sessions.id,
        ip: sessions.ip,
        userAgent: sessions.userAgent,
        createdAt: sessions.createdAt,
        lastSeenAt: sessions.lastSeenAt,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .orderBy(sql`${sessions.lastSeenAt} desc`);
  }

  setCookies(res: Response, token: string, csrfToken: string, expiresAt: Date): void {
    const common = { secure: this.config.COOKIE_SECURE, path: '/', expires: expiresAt };
    res.cookie(SESSION_COOKIE, token, { ...common, httpOnly: true, sameSite: 'lax' });
    // Readable by the web app, which echoes it in the X-CSRF-Token header (double-submit, checked against the session).
    res.cookie(CSRF_COOKIE, csrfToken, { ...common, httpOnly: false, sameSite: 'strict' });
  }

  clearCookies(res: Response): void {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
  }
}
