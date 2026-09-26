import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import sharp from 'sharp';
import { inventoryMovements } from '../src/db/schema';
import { Client, createActiveSeller, createPublishedProduct, createSuperAdmin, createTestApp, diaperProduct, TestContext, testImage } from './helpers';

let ctx: TestContext;
let admin: Client;
let seller: Awaited<ReturnType<typeof createActiveSeller>>;
const http = () => request(ctx.app.getHttpServer());

beforeAll(async () => {
  ctx = await createTestApp();
  admin = (await createSuperAdmin(ctx)).client;
  seller = await createActiveSeller(ctx, admin, { name: 'Island Baby Supplies' });
});
afterAll(() => ctx.close());

describe('creating products', () => {
  it('stores prices in minor units in the seller currency and records opening stock', async () => {
    const res = await seller.client.post('/me/products', diaperProduct({ variants: [{ sku: 'IBS-NB-1', name: 'Newborn 40 pack', price: '38.5', quantity: 12 }] }));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.hsCode).toBe('961900');
    expect(res.body.variants[0]).toMatchObject({ sku: 'IBS-NB-1', quantityOnHand: 12, price: { amountMinor: '3850', currency: 'XCD', formatted: 'EC$38.50' } });
    expect(res.body.categoryPath.map((c: { slug: string }) => c.slug)).toEqual(['baby-and-child', 'diapers-and-wipes']);
    const ledger = await ctx.db.select().from(inventoryMovements).where(eq(inventoryMovements.variantId, res.body.variants[0].id));
    expect(ledger).toMatchObject([{ delta: 12, quantityAfter: 12, reason: 'INITIAL' }]);
  });

  it('validates categories, SKUs, prices and HS codes', async () => {
    expect((await seller.client.post('/me/products', diaperProduct({ categorySlug: 'no-such-category' }))).body.error.code).toBe('UNKNOWN_CATEGORY');
    expect((await seller.client.post('/me/products', diaperProduct({ hsCode: '96' }))).status).toBe(400);
    expect((await seller.client.post('/me/products', diaperProduct({ variants: [{ sku: 'X1', name: 'x', price: '0', quantity: 1 }] }))).body.error.code).toBe('INVALID_PRICE');
    expect((await seller.client.post('/me/products', diaperProduct({ variants: [{ sku: 'X1', name: 'x', price: '1.234', quantity: 1 }] }))).status).toBe(400);
    await seller.client.post('/me/products', diaperProduct({ variants: [{ sku: 'DUP-1', name: 'a', price: '1.00', quantity: 1 }] })).expect(201);
    expect((await seller.client.post('/me/products', diaperProduct({ variants: [{ sku: 'DUP-1', name: 'b', price: '1.00', quantity: 1 }] }))).body.error.code).toBe('SKU_TAKEN');
  });

  it('refuses submission until images, HS code, weight, dimensions and description are present', async () => {
    const { body } = await seller.client.post('/me/products', diaperProduct({ hsCode: undefined, weightGrams: undefined, description: '' }));
    const res = await seller.client.post(`/me/products/${body.id}/submit`);
    expect(res.body.error.code).toBe('PRODUCT_INCOMPLETE');
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['description', 'hsCode', 'images', 'weightGrams']);
  });

  it('only lets the owner see or edit a product', async () => {
    const other = await createActiveSeller(ctx, admin, { name: 'Other Store' });
    const { body } = await seller.client.post('/me/products', diaperProduct());
    expect((await other.client.get(`/me/products/${body.id}`)).status).toBe(404);
    expect((await other.client.patch(`/me/products/${body.id}`, { title: 'Hijacked' })).status).toBe(404);
  });
});

describe('images', () => {
  it('re-encodes uploads as WebP, strips metadata and rejects non-images', async () => {
    const { body } = await seller.client.post('/me/products', diaperProduct());
    const withExif = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#fff' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'Secret location', Artist: 'Phone' } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const up = await seller.client.upload(`/me/products/${body.id}/images`, withExif, 'IMG_0001.jpg', { altText: 'Pack front' });
    expect(up.status).toBe(201);
    const stored = [...ctx.storage.files.values()].at(-1)!;
    const meta = await sharp(stored).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect(Math.max(meta.width!, meta.height!)).toBe(1600);

    const bad = await seller.client.upload(`/me/products/${body.id}/images`, Buffer.from('<?php echo "hi"; ?>'), 'evil.jpg');
    expect(bad.body.error.code).toBe('UNSUPPORTED_IMAGE');
    const none = await seller.client.agent.post(`/api/v1/me/products/${body.id}/images`).set('x-csrf-token', seller.client.csrf).field('altText', 'No file');
    expect(none.body.error.code).toBe('FILE_REQUIRED');
  });

  it('keeps draft images private until the product is approved', async () => {
    const { body } = await seller.client.post('/me/products', diaperProduct());
    const up = await seller.client.upload(`/me/products/${body.id}/images`, await testImage());
    const url = up.body.images[0].url as string;
    expect((await http().get(url)).status).toBe(404);
    expect((await seller.client.get(url.replace('/api/v1', ''))).status).toBe(200);
    expect((await admin.get(url.replace('/api/v1', ''))).status).toBe(200);
    await seller.client.post(`/me/products/${body.id}/submit`).expect(200);
    await admin.post(`/admin/products/${body.id}/review`, { decision: 'APPROVE' }).expect(204);
    const pub = await http().get(url);
    expect(pub.status).toBe(200);
    expect(pub.headers['cache-control']).toContain('public');
  });
});

describe('review and lifecycle', () => {
  it('goes draft -> pending review -> active, and becomes public', async () => {
    const product = await createPublishedProduct(ctx, seller, admin, { title: 'Lifecycle Diapers' });
    expect(product.status).toBe('ACTIVE');
    const pub = await http().get(`/api/v1/products/${product.id}`);
    expect(pub.status).toBe(200);
    expect(pub.body).toMatchObject({ title: 'Lifecycle Diapers', inStock: true, shipsFrom: { code: 'LC' }, shipsTo: [{ code: 'VC' }] });
    expect(pub.body).not.toHaveProperty('reviewNotes');
    expect(pub.body.variants[0]).toHaveProperty('available', 20);
    await ctx.flush();
    expect(ctx.email.sent.some((m) => m.to === seller.email && /approved/.test(m.subject))).toBe(true);
  });

  it('content edits send a live product back to review; price and stock edits do not', async () => {
    const product = await createPublishedProduct(ctx, seller, admin);
    const variantId = product.variants[0].id;
    const price = await seller.client.patch(`/me/products/${product.id}/variants/${variantId}`, { price: '42.00' });
    expect(price.body.status).toBe('ACTIVE');
    expect(price.body.variants[0].price.formatted).toBe('EC$42.00');
    const dims = await seller.client.patch(`/me/products/${product.id}`, { weightGrams: 1900 });
    expect(dims.body.status).toBe('ACTIVE');
    // A partial update must not reset fields it did not mention.
    expect(dims.body.description).toBe(product.description);
    const title = await seller.client.patch(`/me/products/${product.id}`, { title: 'Now With Aloe' });
    expect(title.body.status).toBe('PENDING_REVIEW');
    expect((await http().get(`/api/v1/products/${product.id}`)).status).toBe(404);
  });

  it('switches between ACTIVE and OUT_OF_STOCK from stock counts, with a ledger entry per change', async () => {
    const product = await createPublishedProduct(ctx, seller, admin);
    const variantId = product.variants[0].id;
    const empty = await seller.client.put(`/me/products/${product.id}/variants/${variantId}/stock`, { quantity: 0, note: 'Sold out at market' });
    expect(empty.body.status).toBe('OUT_OF_STOCK');
    const pub = await http().get(`/api/v1/products/${product.id}`);
    expect(pub.status).toBe(200);
    expect(pub.body.inStock).toBe(false);
    const restock = await seller.client.put(`/me/products/${product.id}/variants/${variantId}/stock`, { quantity: 30 });
    expect(restock.body.status).toBe('ACTIVE');
    const ledger = await ctx.db.select().from(inventoryMovements).where(eq(inventoryMovements.variantId, variantId));
    expect(ledger.map((l) => [l.reason, l.delta, l.quantityAfter])).toEqual([
      ['INITIAL', 20, 20],
      ['STOCK_COUNT', -20, 0],
      ['STOCK_COUNT', 30, 30],
    ]);
    const dbError = await ctx.db.execute(sql`update ${inventoryMovements} set delta = 999`).then(() => 'ok', (e: Error) => String((e.cause as Error)?.message));
    expect(dbError).toMatch(/append-only/);
  });

  it('reject and request-changes notify the seller; request-changes returns to draft', async () => {
    const { body } = await seller.client.post('/me/products', diaperProduct());
    await seller.client.upload(`/me/products/${body.id}/images`, await testImage()).expect(201);
    await seller.client.post(`/me/products/${body.id}/submit`).expect(200);
    await admin.post(`/admin/products/${body.id}/review`, { decision: 'REQUEST_CHANGES', notes: 'Photo must show the pack size' }).expect(204);
    const draft = (await seller.client.get(`/me/products/${body.id}`)).body;
    expect(draft).toMatchObject({ status: 'DRAFT', reviewNotes: 'Photo must show the pack size' });
    await seller.client.post(`/me/products/${body.id}/submit`).expect(200);
    await admin.post(`/admin/products/${body.id}/review`, { decision: 'REJECT', notes: 'Restricted item' }).expect(204);
    expect((await seller.client.get(`/me/products/${body.id}`)).body.status).toBe('REJECTED');
    await ctx.flush();
    expect(ctx.email.sent.filter((m) => m.to === seller.email && /needs changes|not approved/.test(m.subject)).length).toBeGreaterThanOrEqual(2);
  });

  it('suspension by IIE hides a product and blocks seller edits; archiving hides it too', async () => {
    const product = await createPublishedProduct(ctx, seller, admin);
    await admin.post(`/admin/products/${product.id}/suspend`, { reason: 'Mislabelled' }).expect(204);
    expect((await http().get(`/api/v1/products/${product.id}`)).status).toBe(404);
    expect((await seller.client.patch(`/me/products/${product.id}`, { weightGrams: 1 })).body.error.code).toBe('PRODUCT_SUSPENDED');
    await admin.post(`/admin/products/${product.id}/reinstate`, { reason: 'Label fixed' }).expect(204);
    expect((await http().get(`/api/v1/products/${product.id}`)).status).toBe(200);
    await seller.client.post(`/me/products/${product.id}/archive`).expect(200);
    expect((await http().get(`/api/v1/products/${product.id}`)).status).toBe(404);
    expect((await seller.client.post(`/me/products/${product.id}/restore`)).body.status).toBe('DRAFT');
  });

  it('buyers cannot use seller or review endpoints', async () => {
    const buyer = await (await import('./helpers')).createActiveBuyer(ctx);
    expect((await buyer.client.get('/me/products')).status).toBe(403);
    expect((await buyer.client.get('/admin/products')).status).toBe(403);
  });
});
