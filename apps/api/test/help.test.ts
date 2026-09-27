import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Client, createActiveBuyer, createSuperAdmin, createTestApp, grantRole, register, signedIn, TestContext } from './helpers';

let ctx: TestContext;
let admin: Client;
const http = () => request(ctx.app.getHttpServer());

beforeAll(async () => {
  ctx = await createTestApp();
  admin = (await createSuperAdmin(ctx)).client;
});
afterAll(() => ctx.close());

describe('Help Center', () => {
  it('seeds drafts for IIE to review; nothing is public until published', async () => {
    const all = (await admin.get('/admin/help')).body.items;
    expect(all.length).toBeGreaterThanOrEqual(10);
    expect(all.every((a: { status: string }) => a.status === 'DRAFT')).toBe(true);
    expect(all.some((a: { needsConfirmation: boolean }) => a.needsConfirmation)).toBe(true);
    expect((await http().get('/api/v1/help')).body.items).toEqual([]);
    expect((await http().get('/api/v1/help/what-is-iie')).status).toBe(404);
  });

  it('support staff edit and publish; the public lists and searches by audience', async () => {
    const agent = await register(ctx, { countryCode: 'VC' });
    await grantRole(ctx, agent.id, 'customer_support');
    const support = await signedIn(ctx, agent.email);
    const buyer = await createActiveBuyer(ctx, 'VC');
    expect((await buyer.client.get('/admin/help')).status).toBe(403);

    const all = (await support.get('/admin/help')).body.items;
    const duties = all.find((a: { slug: string }) => a.slug === 'import-duties-and-taxes');
    const sellers = all.find((a: { slug: string }) => a.slug === 'getting-paid');
    const everyone = all.find((a: { slug: string }) => a.slug === 'contacting-iie');
    const edited = await support.patch(`/admin/help/${duties.id}`, { summary: 'Duties are estimated at checkout and paid to customs on arrival.' });
    expect(edited.body).toMatchObject({ summary: 'Duties are estimated at checkout and paid to customs on arrival.', status: 'DRAFT', sortOrder: 110 });
    expect((await support.patch(`/admin/help/${duties.id}`, { slug: 'getting-paid' })).body.error.code).toBe('SLUG_TAKEN');
    for (const a of [duties, sellers, everyone]) await support.post(`/admin/help/${a.id}/publish`).expect(200);

    const buyers = (await http().get('/api/v1/help?audience=BUYER')).body.items.map((a: { slug: string }) => a.slug);
    expect(buyers).toEqual(['contacting-iie', 'import-duties-and-taxes']);
    const found = (await http().get('/api/v1/help?q=customs duty')).body.items.map((a: { slug: string }) => a.slug);
    expect(found[0]).toBe('import-duties-and-taxes');
    expect((await http().get('/api/v1/help/getting-paid')).body).toMatchObject({ title: 'Getting paid', audience: 'SELLER', body: expect.stringMatching(/7 days after the buyer confirms/) });

    const created = await support.post('/admin/help', { slug: 'hurricane-season', title: 'Deliveries in hurricane season', audience: 'ALL', body: 'Shipments may be delayed when ports close.' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'DRAFT', summary: '', sortOrder: 100 });
    expect((await support.post('/admin/help', { slug: 'hurricane-season', title: 'Again', audience: 'ALL', body: 'Duplicate web address here.' })).body.error.code).toBe('SLUG_TAKEN');

    await support.post(`/admin/help/${sellers.id}/unpublish`).expect(200);
    expect((await http().get('/api/v1/help/getting-paid')).status).toBe(404);
  });
});
