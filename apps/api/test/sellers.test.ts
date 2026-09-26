import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { sellerProfiles } from '../src/db/schema';
import {
  Client,
  createActiveSeller,
  createPublishedProduct,
  createSuperAdmin,
  createTestApp,
  grantRole,
  register,
  sellerOnboarding,
  signedIn,
  TestContext,
  testImage,
  uniqueEmail,
} from './helpers';

let ctx: TestContext;
let admin: Client;
beforeAll(async () => {
  ctx = await createTestApp();
  admin = (await createSuperAdmin(ctx)).client;
});
afterAll(() => ctx.close());

async function applyingSeller(countryCode = 'LC', name = 'Island Baby Supplies') {
  const { id, email } = await register(ctx, { accountType: 'SELLER', countryCode, email: uniqueEmail('applicant') });
  const client = await signedIn(ctx, email);
  await client.post('/me/onboarding', { seller: { ...sellerOnboarding(countryCode), businessName: name } }).expect(204);
  const sellerId = (await client.get('/me')).body.sellerProfile.id as string;
  return { userId: id, email, client, sellerId };
}

describe('seller review', () => {
  it('approve -> payout setup -> active, with a storefront and emails at each step', async () => {
    const s = await applyingSeller('LC', 'Island Baby Supplies');
    const queue = await admin.get('/admin/sellers?status=UNDER_REVIEW&pageSize=100');
    expect(queue.body.items.map((i: { id: string }) => i.id)).toContain(s.sellerId);

    // Products cannot be created before approval.
    expect((await s.client.post('/me/products', {})).status).toBe(400);
    const early = await s.client.post('/me/products', { title: 'x' });
    expect(early.status).toBe(400);

    await admin.post(`/admin/sellers/${s.sellerId}/review`, { decision: 'APPROVE' }).expect(204);
    const approved = (await s.client.get('/me/seller')).body;
    expect(approved.profile.status).toBe('APPROVED');
    expect(approved.storefront.slug).toMatch(/^island-baby-supplies/);
    await ctx.flush();
    expect(ctx.email.sent.some((m) => m.to === s.email && /approved/i.test(m.subject))).toBe(true);

    // Approved but not yet active: storefront is not public.
    expect((await request(ctx.app.getHttpServer()).get(`/api/v1/sellers/${approved.storefront.slug}`)).status).toBe(404);

    await admin.post(`/admin/sellers/${s.sellerId}/payout-setup`, { note: 'Bank transfer, verified by phone' }).expect(204);
    expect((await s.client.get('/me/seller')).body.profile.status).toBe('ACTIVE');
    const store = await request(ctx.app.getHttpServer()).get(`/api/v1/sellers/${approved.storefront.slug}`);
    expect(store.status).toBe(200);
    expect(store.body).toMatchObject({ name: 'Island Baby Supplies', country: 'LC', verified: true, rating: null });
    expect(store.body.shipsTo).toEqual([{ code: 'VC', name: 'St. Vincent and the Grenadines' }]);
  });

  it('request changes -> seller edits and resubmits -> back in the queue', async () => {
    const s = await applyingSeller();
    await admin.post(`/admin/sellers/${s.sellerId}/review`, { decision: 'REQUEST_CHANGES' }).expect(400); // notes required
    await admin.post(`/admin/sellers/${s.sellerId}/review`, { decision: 'REQUEST_CHANGES', notes: 'Registration number does not match the registry' }).expect(204);
    const draft = (await s.client.get('/me/seller')).body;
    expect(draft.profile.status).toBe('DRAFT');
    expect(draft.profile.reviewNotes).toMatch(/registry/);
    await s.client.patch('/me/seller/profile', { registrationNumber: 'C-2026-9999' }).expect(204);
    await s.client.post('/me/seller/resubmit').expect(204);
    expect((await s.client.get('/me/seller')).body.profile).toMatchObject({ status: 'UNDER_REVIEW', registrationNumber: 'C-2026-9999' });
    expect((await s.client.patch('/me/seller/profile', { category: 'Other' })).body.error.code).toBe('SELLER_NOT_EDITABLE');
  });

  it('reject is final and cannot be reviewed twice', async () => {
    const s = await applyingSeller();
    await admin.post(`/admin/sellers/${s.sellerId}/review`, { decision: 'REJECT', notes: 'Business is not registered in St. Lucia' }).expect(204);
    expect((await admin.post(`/admin/sellers/${s.sellerId}/review`, { decision: 'APPROVE' })).body.error.code).toBe('NOT_UNDER_REVIEW');
    expect((await s.client.post('/me/seller/resubmit')).body.error.code).toBe('SELLER_NOT_RESUBMITTABLE');
  });

  it('country admins review only their own country, and nobody reviews themselves', async () => {
    const vcAdminUser = await register(ctx, { countryCode: 'VC', email: uniqueEmail('vcadmin') });
    await grantRole(ctx, vcAdminUser.id, 'country_admin', 'VC');
    const vcAdmin = await signedIn(ctx, vcAdminUser.email);
    const lcApplicant = await applyingSeller('LC');
    expect((await vcAdmin.get('/admin/sellers?pageSize=100')).body.items.map((i: { id: string }) => i.id)).not.toContain(lcApplicant.sellerId);
    expect((await vcAdmin.post(`/admin/sellers/${lcApplicant.sellerId}/review`, { decision: 'APPROVE' })).status).toBe(404);

    // A compliance officer who is also a seller cannot approve their own application.
    const self = await applyingSeller('LC');
    await grantRole(ctx, self.userId, 'compliance_officer');
    const selfAsOfficer = await signedIn(ctx, self.email);
    expect((await selfAsOfficer.post(`/admin/sellers/${self.sellerId}/review`, { decision: 'APPROVE' })).status).toBe(403);
    const buyerOnly = await signedIn(ctx, (await register(ctx)).email);
    expect((await buyerOnly.get('/admin/sellers')).status).toBe(403);
  });

  it('suspending a seller hides the storefront and its products; reinstating restores them', async () => {
    const seller = await createActiveSeller(ctx, admin, { name: 'Castries Kids' });
    const product = await createPublishedProduct(ctx, seller, admin);
    const http = request(ctx.app.getHttpServer());
    expect((await http.get(`/api/v1/products/${product.id}`)).status).toBe(200);
    await admin.post(`/admin/sellers/${seller.sellerId}/suspend`, { reason: 'Customer complaints under investigation' }).expect(204);
    expect((await http.get(`/api/v1/products/${product.id}`)).status).toBe(404);
    expect((await http.get(`/api/v1/sellers/${seller.slug}`)).status).toBe(404);
    expect((await http.get(`/api/v1/media/${product.images[0].url.split('/').pop()}`)).status).toBe(404);
    await admin.post(`/admin/sellers/${seller.sellerId}/reinstate`, { reason: 'Resolved' }).expect(204);
    expect((await http.get(`/api/v1/products/${product.id}`)).status).toBe(200);
  });
});

describe('storefront', () => {
  it('lets an approved seller edit the storefront and upload a logo; slugs are unique', async () => {
    const a = await createActiveSeller(ctx, admin, { name: 'Soufriere Supplies' });
    const b = await createActiveSeller(ctx, admin, { name: 'Vieux Fort Goods' });
    const res = await a.client.patch('/me/storefront', { description: 'Family business since 1998.', returnPolicy: 'Unopened items within 14 days.', slug: 'soufriere-supplies-shop' });
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('soufriere-supplies-shop');
    expect((await b.client.patch('/me/storefront', { slug: 'soufriere-supplies-shop' })).body.error.code).toBe('SLUG_TAKEN');
    expect((await a.client.patch('/me/storefront', { slug: 'Bad Slug!' })).status).toBe(400);

    const logo = await a.client.upload('/me/storefront/logo', await testImage('png', 1200, 1200), 'logo.png');
    expect(logo.status).toBe(201);
    const file = await request(ctx.app.getHttpServer()).get(logo.body.logoUrl);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/webp');
    const storefront = await request(ctx.app.getHttpServer()).get('/api/v1/sellers/soufriere-supplies-shop');
    expect(storefront.body).toMatchObject({ description: 'Family business since 1998.', returnPolicy: 'Unopened items within 14 days.', logoUrl: logo.body.logoUrl });
  });

  it('keeps the payout note and activation in the audit trail', async () => {
    const seller = await createActiveSeller(ctx, admin);
    const [row] = await ctx.db.select().from(sellerProfiles).where(eq(sellerProfiles.id, seller.sellerId));
    expect(row!.payoutSetupNote).toMatch(/Pilot/);
    const audit = await admin.get(`/admin/audit-logs?entityType=seller_profile&entityId=${seller.sellerId}`);
    expect(audit.body.items.map((i: { action: string }) => i.action)).toEqual(expect.arrayContaining(['seller.review.approve', 'seller.activated']));
  });
});
