import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Client, createActiveBuyer, createActiveSeller, createPublishedProduct, createSuperAdmin, createTestApp, register, signedIn, TestContext } from './helpers';

let ctx: TestContext;
let admin: Client;
let seller: Awaited<ReturnType<typeof createActiveSeller>>;
let product: Awaited<ReturnType<typeof createPublishedProduct>>;
let variantId: string;

beforeAll(async () => {
  ctx = await createTestApp();
  admin = (await createSuperAdmin(ctx)).client;
  seller = await createActiveSeller(ctx, admin, { name: 'Cart Test Store' });
  product = await createPublishedProduct(ctx, seller, admin, { variants: [{ sku: 'CT-1', name: '56 pack', price: '45.00', quantity: 10 }] });
  variantId = product.variants[0].id;
});
afterAll(() => ctx.close());

describe('cart', () => {
  it('requires a signed-in, active buyer', async () => {
    expect((await request(ctx.app.getHttpServer()).get('/api/v1/me/cart')).status).toBe(401);
    const unverified = await register(ctx, { countryCode: 'VC', verify: false });
    const client = await signedIn(ctx, unverified.email);
    expect((await client.post('/me/cart/items', { variantId, quantity: 1 })).body.error.code).toBe('ACCOUNT_NOT_ACTIVE');
    expect((await seller.client.get('/me/cart')).status).toBe(403); // seller-only accounts have no cart
  });

  it('adds, merges, updates and removes lines, with live prices and subtotals per seller', async () => {
    const buyer = await createActiveBuyer(ctx, 'VC');
    const added = await buyer.client.post('/me/cart/items', { variantId, quantity: 2 });
    expect(added.status).toBe(201);
    await buyer.client.post('/me/cart/items', { variantId, quantity: 1 }).expect(201);
    let cart = (await buyer.client.get('/me/cart')).body;
    expect(cart.itemCount).toBe(3);
    expect(cart.sellers[0].seller.name).toBe('Cart Test Store');
    expect(cart.sellers[0].lines[0]).toMatchObject({ quantity: 3, unitPrice: { formatted: 'EC$45.00' }, lineTotal: { formatted: 'EC$135.00' }, issues: [] });
    expect(cart.sellers[0].subtotal.formatted).toBe('EC$135.00');
    expect(cart.notes[0]).toMatch(/calculated at checkout/);

    // Price changes are reflected immediately (prices are frozen only at checkout).
    await seller.client.patch(`/me/products/${product.id}/variants/${variantId}`, { price: '40.00' }).expect(200);
    cart = (await buyer.client.get('/me/cart')).body;
    expect(cart.sellers[0].subtotal.formatted).toBe('EC$120.00');

    cart = (await buyer.client.patch(`/me/cart/items/${variantId}`, { quantity: 1 })).body;
    expect(cart.itemCount).toBe(1);
    cart = (await buyer.client.delete(`/me/cart/items/${variantId}`)).body;
    expect(cart.sellers).toEqual([]);
  });

  it('enforces stock, own-product and shipping-lane rules', async () => {
    const buyer = await createActiveBuyer(ctx, 'VC');
    const tooMany = await buyer.client.post('/me/cart/items', { variantId, quantity: 11 });
    expect(tooMany.body.error).toMatchObject({ code: 'INSUFFICIENT_STOCK', message: 'Only 10 available' });

    // A St. Lucia buyer: there is no St. Lucia -> St. Lucia lane in the pilot.
    const local = await createActiveBuyer(ctx, 'LC');
    expect((await local.client.post('/me/cart/items', { variantId, quantity: 1 })).body.error.code).toBe('NOT_SHIPPABLE_TO_YOU');

    // The seller also buys (buyer + seller account) but cannot buy their own product.
    const both = await register(ctx, { accountType: 'BUYER_SELLER', countryCode: 'LC' });
    const bothClient = await signedIn(ctx, both.email);
    const { buyerOnboarding, sellerOnboarding, uploadSellerDocument } = await import('./helpers');
    await bothClient.post('/me/onboarding', { buyer: buyerOnboarding('LC'), seller: sellerOnboarding('LC') }).expect(204);
    const bothSellerId = (await bothClient.get('/me')).body.sellerProfile.id;
    await admin.post(`/admin/seller-documents/${(await uploadSellerDocument(bothClient)).body.id}/review`, { decision: 'ACCEPT' }).expect(204);
    await admin.post(`/admin/sellers/${bothSellerId}/review`, { decision: 'APPROVE' }).expect(204);
    await admin.post(`/admin/sellers/${bothSellerId}/payout-setup`, { note: 'Pilot arrangement' }).expect(204);
    const own = await createPublishedProduct(ctx, { client: bothClient }, admin, { variants: [{ sku: 'OWN-1', name: 'x', price: '5.00', quantity: 5 }] });
    expect((await bothClient.post('/me/cart/items', { variantId: own.variants[0].id, quantity: 1 })).body.error.code).toBe('OWN_PRODUCT');

    const hidden = await buyer.client.post('/me/cart/items', { variantId: '00000000-0000-4000-8000-000000000000', quantity: 1 });
    expect(hidden.status).toBe(404);
  });

  it('flags lines that became unavailable and leaves them out of the subtotal', async () => {
    const buyer = await createActiveBuyer(ctx, 'VC');
    const other = await createPublishedProduct(ctx, seller, admin, { variants: [{ sku: 'CT-2', name: 'Wipes', price: '10.00', quantity: 3 }] });
    await buyer.client.post('/me/cart/items', { variantId, quantity: 1 }).expect(201);
    await buyer.client.post('/me/cart/items', { variantId: other.variants[0].id, quantity: 3 }).expect(201);
    await seller.client.put(`/me/products/${other.id}/variants/${other.variants[0].id}/stock`, { quantity: 1 }).expect(200);
    let cart = (await buyer.client.get('/me/cart')).body;
    const wipes = cart.sellers[0].lines.find((l: { sku: string }) => l.sku === 'CT-2');
    expect(wipes.issues).toEqual(['INSUFFICIENT_STOCK']);
    expect(cart.sellers[0].readyForCheckout).toBe(false);
    expect(cart.sellers[0].subtotal.formatted).toBe('EC$40.00');

    await admin.post(`/admin/products/${product.id}/suspend`, { reason: 'Recall check' }).expect(204);
    cart = (await buyer.client.get('/me/cart')).body;
    expect(cart.sellers[0].lines.find((l: { sku: string }) => l.sku === 'CT-1').issues).toEqual(['UNAVAILABLE']);
    await admin.post(`/admin/products/${product.id}/reinstate`, { reason: 'Cleared' }).expect(204);
  });

  it('notes when the cart has more than one seller', async () => {
    const buyer = await createActiveBuyer(ctx, 'VC');
    const second = await createActiveSeller(ctx, admin, { name: 'Second Store' });
    const p2 = await createPublishedProduct(ctx, second, admin, { variants: [{ sku: 'S2-1', name: 'x', price: '9.99', quantity: 5 }] });
    await buyer.client.post('/me/cart/items', { variantId, quantity: 1 }).expect(201);
    const cart = (await buyer.client.post('/me/cart/items', { variantId: p2.variants[0].id, quantity: 1 })).body;
    expect(cart.sellers).toHaveLength(2);
    expect(cart.notes.join(' ')).toMatch(/checked out and shipped separately/);
  });
});

describe('saved items and addresses', () => {
  it('saves public products and sellers only, and shows ones that disappear as unavailable', async () => {
    const buyer = await createActiveBuyer(ctx, 'VC');
    await buyer.client.put(`/me/saved/products/${product.id}`).expect(204);
    await buyer.client.put(`/me/saved/sellers/${seller.slug}`).expect(204);
    expect((await buyer.client.get('/me/saved/products')).body.items[0]).toMatchObject({ id: product.id, available: true });
    expect((await buyer.client.get('/me/saved/sellers')).body.items[0]).toMatchObject({ slug: seller.slug, available: true });

    const { body: draft } = await seller.client.post('/me/products', (await import('./helpers')).diaperProduct());
    expect((await buyer.client.put(`/me/saved/products/${draft.id}`)).status).toBe(404);

    await admin.post(`/admin/products/${product.id}/suspend`, { reason: 'Check' }).expect(204);
    expect((await buyer.client.get('/me/saved/products')).body.items[0]).toMatchObject({ id: product.id, available: false });
    await admin.post(`/admin/products/${product.id}/reinstate`, { reason: 'Cleared after check' }).expect(204);
    await buyer.client.delete(`/me/saved/products/${product.id}`).expect(204);
    expect((await buyer.client.get('/me/saved/products')).body.items).toEqual([]);
  });

  it('manages delivery addresses in the buyer country', async () => {
    const buyer = await createActiveBuyer(ctx, 'VC');
    let list = (await buyer.client.get('/me/addresses')).body.items;
    expect(list).toHaveLength(1);
    expect(list[0].isDefault).toBe(true);
    const wrong = await buyer.client.post('/me/addresses', { line1: '1 Main St', city: 'Castries', countryCode: 'LC' });
    expect(wrong.body.error.code).toBe('ADDRESS_COUNTRY_MISMATCH');
    list = (await buyer.client.post('/me/addresses', { label: 'Work', line1: 'Halifax Street', city: 'Kingstown', countryCode: 'VC', makeDefault: true })).body.items;
    const work = list.find((a: { label: string }) => a.label === 'Work');
    expect(work.isDefault).toBe(true);
    expect((await buyer.client.delete(`/me/addresses/${work.id}`)).body.error.code).toBe('DEFAULT_ADDRESS');
    const home = list.find((a: { label: string }) => a.label !== 'Work');
    await buyer.client.post(`/me/addresses/${home.id}/default`).expect(200);
    expect((await buyer.client.delete(`/me/addresses/${work.id}`)).body.items).toHaveLength(1);
  });
});
