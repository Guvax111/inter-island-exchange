import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { authenticator } from 'otplib';
import { auditLogs, userRoles, users, roles } from '../src/db/schema';
import { MAX_FAILED_LOGINS } from '../src/auth/auth.service';
import {
  Client,
  createTestApp,
  lastEmailTo,
  PASSWORD,
  register,
  signedIn,
  TestContext,
  tokenFromEmail,
  uniqueEmail,
  WEB,
} from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

const http = () => request(ctx.app.getHttpServer());

describe('registration', () => {
  it('creates a DRAFT account with only the chosen self-service roles, and emails a verification link', async () => {
    const email = uniqueEmail();
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, firstName: 'Ann', lastName: 'Lee', countryCode: 'lc', accountType: 'BUYER_SELLER', roles: ['super_admin'] });
    expect(res.status).toBe(202);
    await ctx.flush();

    const [user] = await ctx.db.select().from(users).where(eq(users.email, email));
    expect(user!.status).toBe('DRAFT');
    expect(user!.emailVerifiedAt).toBeNull();
    expect(user!.passwordHash).toMatch(/^\$argon2id\$/);
    const held = await ctx.db
      .select({ key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, user!.id));
    expect(held.map((r) => r.key).sort()).toEqual(['buyer', 'seller']);

    const mail = lastEmailTo(ctx, email);
    expect(mail.subject).toMatch(/confirm/i);
    expect(mail.text).toContain(`${WEB}/verify-email?token=`);

    const audit = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.entityId, user!.id), eq(auditLogs.action, 'user.registered')));
    expect(audit).toHaveLength(1);
  });

  it('answers identically for an existing email and warns the owner instead of revealing the account', async () => {
    const { email } = await register(ctx);
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ email, password: 'another-password-123', firstName: 'X', lastName: 'Y', countryCode: 'VC', accountType: 'SELLER' });
    expect(res.status).toBe(202);
    await ctx.flush();
    expect(lastEmailTo(ctx, email).subject).toMatch(/tried to register/i);
    expect(await ctx.db.select().from(users).where(eq(users.email, email))).toHaveLength(1);
  });

  it('rejects countries where the marketplace is not open yet', async () => {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ email: uniqueEmail(), password: PASSWORD, firstName: 'A', lastName: 'B', countryCode: 'BB', accountType: 'BUYER' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('COUNTRY_NOT_AVAILABLE');
  });

  it('enforces the password policy', async () => {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ email: uniqueEmail(), password: 'short', firstName: 'A', lastName: 'B', countryCode: 'LC', accountType: 'BUYER' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details[0].path).toBe('password');
  });
});

describe('email verification', () => {
  it('verifies once; the link cannot be reused', async () => {
    const { email } = await register(ctx, { verify: false });
    const token = tokenFromEmail(lastEmailTo(ctx, email).text);
    expect((await http().post('/api/v1/auth/verify-email').send({ token })).status).toBe(200);
    const again = await http().post('/api/v1/auth/verify-email').send({ token });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    const [user] = await ctx.db.select().from(users).where(eq(users.email, email));
    expect(user!.emailVerifiedAt).not.toBeNull();
  });

  it('rejects unknown tokens', async () => {
    const res = await http().post('/api/v1/auth/verify-email').send({ token: 'x'.repeat(43) });
    expect(res.status).toBe(400);
  });

  it('resending invalidates the previous link', async () => {
    const { email } = await register(ctx, { verify: false });
    const first = tokenFromEmail(lastEmailTo(ctx, email).text);
    const client = await signedIn(ctx, email);
    expect((await client.post('/auth/resend-verification')).status).toBe(202);
    await ctx.flush();
    const second = tokenFromEmail(lastEmailTo(ctx, email).text);
    expect(second).not.toBe(first);
    expect((await http().post('/api/v1/auth/verify-email').send({ token: first })).status).toBe(400);
    expect((await http().post('/api/v1/auth/verify-email').send({ token: second })).status).toBe(200);
  });
});

describe('login and sessions', () => {
  it('uses the same error for a wrong password and an unknown email', async () => {
    const { email } = await register(ctx);
    const wrong = await new Client(ctx.app).login(email, 'wrong-password-123');
    const unknown = await new Client(ctx.app).login(uniqueEmail(), PASSWORD);
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('sets an httpOnly session cookie and a readable CSRF cookie', async () => {
    const { email } = await register(ctx);
    const res = await new Client(ctx.app).login(email);
    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.find((c) => c.startsWith('iie_session='))).toMatch(/HttpOnly/);
    expect(cookies.find((c) => c.startsWith('iie_session='))).toMatch(/SameSite=Lax/);
    expect(cookies.find((c) => c.startsWith('iie_csrf='))).not.toMatch(/HttpOnly/);
    expect(res.body.csrfToken).toBeTruthy();
  });

  it('requires the CSRF token for state-changing requests', async () => {
    const { email } = await register(ctx);
    const client = await signedIn(ctx, email);
    const noHeader = await client.agent.post('/api/v1/auth/logout');
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.error.code).toBe('CSRF_FAILED');
    expect((await client.post('/auth/logout')).status).toBe(204);
    expect((await client.get('/me')).status).toBe(401);
  });

  it('rejects state-changing requests from other origins', async () => {
    const res = await http().post('/api/v1/auth/login').set('origin', 'https://evil.example').send({ email: uniqueEmail(), password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it(`locks the account for a while after ${MAX_FAILED_LOGINS} failed attempts`, async () => {
    const { email } = await register(ctx);
    const client = new Client(ctx.app);
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) expect((await client.login(email, 'wrong-password-123')).status).toBe(401);
    const locked = await client.login(email);
    expect(locked.status).toBe(401);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('lists sessions and revokes another device', async () => {
    const { email } = await register(ctx);
    const phone = await signedIn(ctx, email);
    const laptop = await signedIn(ctx, email);
    const list = await laptop.get('/auth/sessions');
    expect(list.body.items).toHaveLength(2);
    const other = list.body.items.find((s: { current: boolean }) => !s.current);
    expect((await laptop.delete(`/auth/sessions/${other.id}`)).status).toBe(204);
    expect((await phone.get('/me')).status).toBe(401);
    expect((await laptop.get('/me')).status).toBe(200);
  });
});

describe('password reset and change', () => {
  it('resets with an emailed link, signs out everywhere, and the link is single-use', async () => {
    const { email } = await register(ctx);
    const existing = await signedIn(ctx, email);
    expect((await http().post('/api/v1/auth/password/forgot').send({ email })).status).toBe(202);
    await ctx.flush();
    const token = tokenFromEmail(lastEmailTo(ctx, email).text);
    const newPassword = 'a-brand-new-password-456';
    expect((await http().post('/api/v1/auth/password/reset').send({ token, password: newPassword })).status).toBe(200);
    expect((await existing.get('/me')).status).toBe(401);
    expect((await new Client(ctx.app).login(email, PASSWORD)).status).toBe(401);
    expect((await new Client(ctx.app).login(email, newPassword)).status).toBe(200);
    expect((await http().post('/api/v1/auth/password/reset').send({ token, password: 'yet-another-password' })).status).toBe(400);
    await ctx.flush();
    expect(lastEmailTo(ctx, email).subject).toMatch(/password was changed/i);
  });

  it('does not reveal whether an email is registered', async () => {
    const before = ctx.email.sent.length;
    expect((await http().post('/api/v1/auth/password/forgot').send({ email: uniqueEmail() })).status).toBe(202);
    await ctx.flush();
    expect(ctx.email.sent.length).toBe(before);
  });

  it('changing the password keeps this session and signs out the others', async () => {
    const { email } = await register(ctx);
    const other = await signedIn(ctx, email);
    const current = await signedIn(ctx, email);
    const bad = await current.post('/auth/password/change', { currentPassword: 'nope-nope-nope', newPassword: 'another-good-password' });
    expect(bad.body.error.code).toBe('INVALID_CURRENT_PASSWORD');
    expect((await current.post('/auth/password/change', { currentPassword: PASSWORD, newPassword: 'another-good-password' })).status).toBe(204);
    expect((await current.get('/me')).status).toBe(200);
    expect((await other.get('/me')).status).toBe(401);
  });
});

describe('two-step verification (TOTP)', () => {
  it('requires a code at sign-in once enabled', async () => {
    const { email } = await register(ctx);
    const client = await signedIn(ctx, email);
    const setup = await client.post('/auth/mfa/totp/setup');
    expect(setup.status).toBe(201);
    expect(setup.body.otpauthUrl).toContain('otpauth://totp/');
    expect((await client.post('/auth/mfa/totp/confirm', { code: '000000' })).body.error.code).toBe('MFA_INVALID');
    expect((await client.post('/auth/mfa/totp/confirm', { code: authenticator.generate(setup.body.secret) })).status).toBe(204);

    const noCode = await new Client(ctx.app).login(email);
    expect(noCode.body.error.code).toBe('MFA_REQUIRED');
    const withCode = await new Client(ctx.app).login(email, PASSWORD, authenticator.generate(setup.body.secret));
    expect(withCode.status).toBe(200);
    expect((await client.get('/me')).body.mfaEnabled).toBe(true);
  });
});

describe('rate limiting', () => {
  it('limits sign-in attempts per IP', async () => {
    const limited = await createTestApp({ AUTH_RATE_LIMIT_PER_MIN: '3' });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        statuses.push((await request(limited.app.getHttpServer()).post('/api/v1/auth/login').send({ email: uniqueEmail(), password: PASSWORD })).status);
      }
      expect(statuses).toEqual([401, 401, 401, 429]);
      // Non-auth routes use the general limit.
      expect((await request(limited.app.getHttpServer()).get('/api/v1/countries')).status).toBe(200);
    } finally {
      await limited.close();
    }
  });
});
