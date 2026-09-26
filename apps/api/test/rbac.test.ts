import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { auditLogs, countries } from '../src/db/schema';
import { Client, createSuperAdmin, createTestApp, grantRole, register, signedIn, TestContext } from './helpers';

let ctx: TestContext;
let superAdmin: Awaited<ReturnType<typeof createSuperAdmin>>;
let lcAdmin: { id: string; client: Client };
let lcBuyer: { id: string; email: string };
let vcBuyer: { id: string; email: string };

beforeAll(async () => {
  ctx = await createTestApp();
  superAdmin = await createSuperAdmin(ctx);
  const admin = await register(ctx);
  await superAdmin.client.post(`/admin/users/${admin.id}/roles`, { role: 'country_admin', countryCode: 'LC' }).expect(204);
  lcAdmin = { id: admin.id, client: await signedIn(ctx, admin.email) };
  lcBuyer = await register(ctx, { countryCode: 'LC' });
  vcBuyer = await register(ctx, { countryCode: 'VC' });
});
afterAll(() => ctx.close());

describe('route permissions', () => {
  it('guests are asked to sign in and buyers are refused admin routes', async () => {
    expect((await request(ctx.app.getHttpServer()).get('/api/v1/admin/users')).status).toBe(401);
    const buyer = await signedIn(ctx, lcBuyer.email);
    for (const path of ['/admin/users', '/admin/roles', '/admin/audit-logs', '/admin/lanes']) {
      expect((await buyer.get(path)).status).toBe(403);
    }
    expect((await buyer.patch('/admin/countries/LC', { settings: {} })).status).toBe(403);
  });

  it('public country data needs no sign-in and hides internal settings', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/v1/countries/stvincent');
    expect(res.status).toBe(200);
    expect(res.body.iieCode).toBe('SVG');
    expect(res.body).not.toHaveProperty('settings');
  });
});

describe('country-scoped administration', () => {
  it('a St. Lucia admin sees St. Lucia users only', async () => {
    const list = await lcAdmin.client.get('/admin/users?pageSize=100');
    expect(list.status).toBe(200);
    const countriesSeen = new Set(list.body.items.map((u: { country: string }) => u.country));
    expect([...countriesSeen]).toEqual(['LC']);
    expect((await lcAdmin.client.get(`/admin/users/${lcBuyer.id}`)).status).toBe(200);
    expect((await lcAdmin.client.get(`/admin/users/${vcBuyer.id}`)).status).toBe(404);

    const all = await superAdmin.client.get('/admin/users?countryCode=VC');
    expect(all.body.items.some((u: { id: string }) => u.id === vcBuyer.id)).toBe(true);
  });

  it('can suspend and reactivate a buyer in their country, which signs the buyer out', async () => {
    const buyer = await register(ctx, { countryCode: 'LC' });
    const buyerClient = await signedIn(ctx, buyer.email);
    expect((await lcAdmin.client.post(`/admin/users/${buyer.id}/suspend`, { reason: 'Fraud report' })).status).toBe(204);
    expect((await buyerClient.get('/me')).status).toBe(401);
    const login = await new Client(ctx.app).login(buyer.email);
    expect(login.body.error.code).toBe('ACCOUNT_UNAVAILABLE');
    await ctx.flush();
    expect(ctx.email.sent.some((m) => m.to === buyer.email && /suspended/i.test(m.subject))).toBe(true);

    expect((await lcAdmin.client.post(`/admin/users/${buyer.id}/reactivate`, { reason: 'Cleared' })).status).toBe(204);
    expect((await new Client(ctx.app).login(buyer.email)).status).toBe(200);

    const trail = await ctx.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, buyer.id), eq(auditLogs.actorUserId, lcAdmin.id)));
    expect(trail.map((t) => t.action)).toEqual(expect.arrayContaining(['user.suspended', 'user.reactivated']));
    const suspended = trail.find((t) => t.action === 'user.suspended')!;
    expect(suspended.before).toEqual({ status: 'DRAFT' });
    expect(suspended.after).toMatchObject({ status: 'SUSPENDED', reason: 'Fraud report' });
    expect(suspended.ip).toBeTruthy();
  });

  it('cannot act outside their country, on staff accounts, on themselves, or on roles', async () => {
    expect((await lcAdmin.client.post(`/admin/users/${vcBuyer.id}/suspend`, { reason: 'test' })).status).toBe(404);
    const otherAdmin = await register(ctx, { countryCode: 'LC' });
    await grantRole(ctx, otherAdmin.id, 'country_admin', 'LC');
    expect((await lcAdmin.client.post(`/admin/users/${otherAdmin.id}/suspend`, { reason: 'test' })).status).toBe(403);
    expect((await lcAdmin.client.post(`/admin/users/${lcAdmin.id}/suspend`, { reason: 'test' })).body.error.code).toBe('CANNOT_SUSPEND_SELF');
    expect((await lcAdmin.client.post(`/admin/users/${lcBuyer.id}/roles`, { role: 'super_admin' })).status).toBe(403);
  });

  it('can edit its own country settings but not switch countries on or edit other countries', async () => {
    expect((await lcAdmin.client.patch('/admin/countries/LC', { settings: { public: { tagline: 'Helen of the West Indies' } } })).status).toBe(200);
    expect((await request(ctx.app.getHttpServer()).get('/api/v1/countries/stlucia')).body.info).toEqual({ tagline: 'Helen of the West Indies' });
    expect((await lcAdmin.client.patch('/admin/countries/LC', { marketplaceEnabled: false })).status).toBe(403);
    expect((await lcAdmin.client.patch('/admin/countries/VC', { settings: {} })).status).toBe(403);
    expect((await lcAdmin.client.put('/admin/lanes', { origin: 'LC', destination: 'GD', enabled: true })).status).toBe(403);
  });
});

describe('super administrator', () => {
  it('validates role grants', async () => {
    const target = await register(ctx);
    expect((await superAdmin.client.post(`/admin/users/${target.id}/roles`, { role: 'country_admin' })).body.error.code).toBe('COUNTRY_REQUIRED');
    expect((await superAdmin.client.post(`/admin/users/${target.id}/roles`, { role: 'customer_support', countryCode: 'LC' })).body.error.code).toBe(
      'COUNTRY_NOT_ALLOWED',
    );
    expect((await superAdmin.client.post(`/admin/users/${superAdmin.id}/roles`, { role: 'buyer' })).body.error.code).toBe('CANNOT_CHANGE_OWN_ROLES');
    await superAdmin.client.post(`/admin/users/${target.id}/roles`, { role: 'customer_support' }).expect(204);
    expect((await superAdmin.client.post(`/admin/users/${target.id}/roles`, { role: 'customer_support' })).body.error.code).toBe('ROLE_ALREADY_GRANTED');

    const detail = await superAdmin.client.get(`/admin/users/${target.id}`);
    expect(detail.body.user).not.toHaveProperty('passwordHash');
    const assignment = detail.body.roles.find((r: { role: string }) => r.role === 'customer_support');
    await superAdmin.client.delete(`/admin/users/${target.id}/roles/${assignment.id}`).expect(204);
  });

  it('can add a country and open a trade lane; configuration is data, not code', async () => {
    const created = await superAdmin.client.post('/admin/countries', {
      isoAlpha2: 'MS',
      isoAlpha3: 'MSR',
      name: 'Montserrat',
      iieCode: 'MNI',
      slug: 'montserrat',
      currencyCode: 'XCD',
    });
    expect(created.status).toBe(201);
    expect(created.body.marketplaceEnabled).toBe(false);
    await superAdmin.client.put('/admin/lanes', { origin: 'LC', destination: 'MS', enabled: true }).expect(204);
    const lanes = await request(ctx.app.getHttpServer()).get('/api/v1/lanes');
    expect(lanes.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ origin: 'LC', destination: 'MS' })]));
    const dup = await superAdmin.client.post('/admin/countries', {
      isoAlpha2: 'MS', isoAlpha3: 'MSR', name: 'Montserrat', iieCode: 'MNI', slug: 'montserrat', currencyCode: 'XCD',
    });
    expect(dup.status).toBe(409);
  });
});

describe('audit log', () => {
  it('is readable by platform auditors only', async () => {
    expect((await superAdmin.client.get('/admin/audit-logs?entityType=user')).status).toBe(200);
    expect((await lcAdmin.client.get('/admin/audit-logs')).status).toBe(403);
  });

  it('cannot be modified or deleted, even directly in the database', async () => {
    // Drizzle wraps the driver error; the database's own message is on `cause`.
    const dbError = (query: Promise<unknown>) => query.then(() => 'succeeded', (err: Error) => String((err.cause as Error)?.message ?? err.message));
    expect(await dbError(ctx.db.execute(sql`update ${auditLogs} set action = 'tampered'`))).toMatch(/append-only: UPDATE/);
    expect(await dbError(ctx.db.execute(sql`delete from ${auditLogs}`))).toMatch(/append-only: DELETE/);
    expect(await dbError(ctx.db.execute(sql`truncate ${auditLogs}`))).toMatch(/append-only: TRUNCATE/);
  });

  it('records the country change with before and after values', async () => {
    const [lc] = await ctx.db.select().from(countries).where(eq(countries.isoAlpha2, 'LC'));
    const entries = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.entityId, lc!.id), eq(auditLogs.action, 'country.updated')));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]!.actorUserId).toBe(lcAdmin.id);
    expect(entries[0]!.before).toHaveProperty('settings');
  });
});
