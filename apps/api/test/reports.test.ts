import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ReportsService, weekStartOf } from '../src/reports/reports.service';
import { Client, createActiveBuyer, createActiveSeller, createPublishedProduct, createSuperAdmin, createTestApp, grantRole, lastEmailTo, register, signedIn, TestContext, uniqueEmail } from './helpers';

let ctx: TestContext;
let admin: Client;

beforeAll(async () => {
  ctx = await createTestApp();
  admin = (await createSuperAdmin(ctx)).client;
});
afterAll(() => ctx.close());

describe('weekly directors report', () => {
  it('weeks run Monday to Sunday, St. Vincent time', () => {
    // Sunday 27 Sep 2026, 23:30 in Kingstown is already Monday in UTC.
    expect(weekStartOf(new Date('2026-09-28T03:30:00Z')).toISOString()).toBe('2026-09-21T04:00:00.000Z');
    expect(weekStartOf(new Date('2026-09-28T04:00:00Z')).toISOString()).toBe('2026-09-28T04:00:00.000Z');
  });

  it('previews the week with orders, money and lanes; only permitted staff', async () => {
    const seller = await createActiveSeller(ctx, admin, { name: 'Report Store' });
    const product = await createPublishedProduct(ctx, seller, admin, { variants: [{ sku: `RPT-${randomUUID().slice(0, 6)}`, name: '56 pack', price: '45.00', quantity: 10 }] });
    const buyer = await createActiveBuyer(ctx, 'VC');
    await buyer.client.post('/me/cart/items', { variantId: product.variants[0].id, quantity: 2 }).expect(201);
    const addressId = (await buyer.client.get('/me/addresses')).body.items[0].id;
    const q = (await buyer.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId })).body;
    const iieId = (await buyer.client.post('/me/checkout', { quoteId: q.quoteId })).body.iieId as string;
    const url = new URL((await buyer.client.post(`/me/orders/${iieId}/pay`)).body.redirectUrl);
    await buyer.client.agent.post(url.pathname).set('origin', url.origin).type('form').send({ outcome: 'SUCCEED', token: url.searchParams.get('token') }).expect(303);

    const today = new Date().toISOString().slice(0, 10);
    const res = await admin.get(`/admin/reports/weekly?weekOf=${today}`);
    expect(res.status).toBe(200);
    const f = res.body;
    expect(f.period.from).toBe(weekStartOf(new Date()).toISOString());
    expect(f.orders.placed).toBeGreaterThanOrEqual(1);
    expect(f.orders.paid).toBeGreaterThanOrEqual(1);
    expect(f.money.find((m: { currency: string }) => m.currency === 'XCD')).toMatchObject({ grossSales: expect.stringMatching(/^EC\$/), iieFees: expect.stringMatching(/^EC\$/) });
    expect(f.lanes.find((l: { lane: string }) => l.lane === 'SLU → SVG').orders).toBeGreaterThanOrEqual(1);
    expect(f.waitingOnIie).toMatchObject({ reviewsToModerate: expect.any(Number), messagesAwaitingReply: expect.any(Number) });
    // A week with nothing in it.
    expect((await admin.get('/admin/reports/weekly?weekOf=2020-01-08')).body).toMatchObject({ orders: { placed: 0, paid: 0 }, money: [], lanes: [] });

    expect((await buyer.client.get('/admin/reports/weekly')).status).toBe(403);
    const agent = await register(ctx, { countryCode: 'VC' });
    await grantRole(ctx, agent.id, 'customer_support');
    expect((await (await signedIn(ctx, agent.email)).get('/admin/reports/weekly')).status).toBe(403);
  });

  it('sends on demand and on Monday morning, once per week, to active recipients', async () => {
    expect((await admin.post('/admin/reports/weekly/send')).body.error.code).toBe('NO_RECIPIENTS');
    const director = uniqueEmail('director');
    const former = uniqueEmail('former');
    await admin.post('/admin/reports/recipients', { email: director, name: 'Director One' }).expect(201);
    const off = (await admin.post('/admin/reports/recipients', { email: former, name: 'Former Director' })).body;
    await admin.post(`/admin/reports/recipients/${off.id}/disable`).expect(204);
    expect((await admin.post('/admin/reports/recipients', { email: 'not-an-email', name: 'x' })).body.error.code).toBe('VALIDATION_FAILED');

    const sent = await admin.post('/admin/reports/weekly/send');
    expect(sent.body).toMatchObject({ recipients: 1 });
    await ctx.flush();
    const mail = lastEmailTo(ctx, director);
    expect(mail.subject).toMatch(/^IIE weekly report: /);
    expect(mail.html).toContain('Owed between IIE and partners');
    expect(mail.html).toContain('No payments, refunds or payouts this week');
    expect(mail.text).toContain('WAITING ON IIE');
    expect(ctx.email.sent.some((m) => m.to === former)).toBe(false);

    const reports = ctx.app.get(ReportsService);
    // Monday 28 Sep 2026: 07:59 in Kingstown is too early; 08:00 sends the week of 21 Sep; later ticks do not repeat it.
    expect(await reports.sendWeeklyIfDue(new Date('2026-09-28T11:59:00Z'))).toBe(false);
    expect(await reports.sendWeeklyIfDue(new Date('2026-09-28T12:00:00Z'))).toBe(true);
    expect(await reports.sendWeeklyIfDue(new Date('2026-09-28T13:00:00Z'))).toBe(false);
    expect(await reports.sendWeeklyIfDue(new Date('2026-10-01T13:00:00Z'))).toBe(false);
    const runs = (await admin.get('/admin/reports/runs')).body.items;
    expect(runs.filter((r: { kind: string }) => r.kind === 'SCHEDULED')).toEqual([expect.objectContaining({ weekStart: '2026-09-21T04:00:00.000Z', recipients: 1 })]);
    expect(runs.some((r: { kind: string }) => r.kind === 'MANUAL')).toBe(true);
  });
});
