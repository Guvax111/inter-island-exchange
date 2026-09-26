import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Client, createActiveSeller, createPublishedProduct, createSuperAdmin, createTestApp, diaperProduct, TestContext } from './helpers';

let ctx: TestContext;
let admin: Client;
const ids: Record<string, string> = {};
const search = async (qs: string) => (await request(ctx.app.getHttpServer()).get(`/api/v1/products?${qs}`)).body;
const titles = (body: { items: { title: string }[] }) => body.items.map((i) => i.title).sort();

beforeAll(async () => {
  ctx = await createTestApp();
  admin = (await createSuperAdmin(ctx)).client;
  const lc = await createActiveSeller(ctx, admin, { name: 'Search Test Store' });
  ids.diaper = (await createPublishedProduct(ctx, lc, admin, { title: 'Zephyr Premium Diaper', variants: [{ sku: 'ZD-1', name: 'Pack', price: '60.00', quantity: 5 }] })).id;
  ids.wipes = (await createPublishedProduct(ctx, lc, admin, { title: 'Zephyr Baby Wipes', shortDescription: 'Gentle wipes', description: 'Alcohol-free wipes for sensitive skin.', variants: [{ sku: 'ZW-1', name: 'Pack', price: '12.00', quantity: 0 }] })).id;
  ids.sauce = (await createPublishedProduct(ctx, lc, admin, { title: 'Zephyr Pepper Sauce', shortDescription: 'Scotch bonnet sauce', description: 'Hot pepper sauce made with local peppers.', categorySlug: 'food-and-beverage', hsCode: '210390', variants: [{ sku: 'ZP-1', name: 'Bottle', price: '25.00', quantity: 3 }] })).id;
  // A draft must never appear.
  await lc.client.post('/me/products', diaperProduct({ title: 'Zephyr Draft Diaper', variants: [{ sku: 'ZX-1', name: 'x', price: '1.00', quantity: 1 }] })).expect(201);
  // A seller in a country without an open lane to St. Vincent (Grenada opened for this test, no lane).
  await admin.patch('/admin/countries/GD', { marketplaceEnabled: true }).expect(200);
  const gd = await createActiveSeller(ctx, admin, { countryCode: 'GD', name: 'Grenada Store' });
  ids.nutmeg = (await createPublishedProduct(ctx, gd, admin, { title: 'Zephyr Nutmeg Jam', shortDescription: 'Spiced jam', description: 'Jam made from Grenada nutmeg fruit.', categorySlug: 'food-and-beverage', countryOfOrigin: 'GD', hsCode: '200799', variants: [{ sku: 'ZN-1', name: 'Jar', price: '18.00', quantity: 4 }] })).id;
});
afterAll(() => ctx.close());

describe('marketplace search', () => {
  it('matches stemmed words ("diapers" finds "Diaper") and partial words', async () => {
    expect(titles(await search('q=zephyr diapers'))).toEqual(['Zephyr Premium Diaper']);
    expect(titles(await search('q=zeph'))).toEqual(['Zephyr Baby Wipes', 'Zephyr Nutmeg Jam', 'Zephyr Pepper Sauce', 'Zephyr Premium Diaper']);
  });

  it('never shows drafts', async () => {
    expect(titles(await search('q=zephyr draft'))).not.toContain('Zephyr Draft Diaper');
  });

  it('filters by category including sub-categories', async () => {
    expect(titles(await search('q=zephyr&category=baby-and-child'))).toEqual(['Zephyr Baby Wipes', 'Zephyr Premium Diaper']);
    expect(titles(await search('q=zephyr&category=food-and-beverage'))).toEqual(['Zephyr Nutmeg Jam', 'Zephyr Pepper Sauce']);
  });

  it('filters by seller country, country of origin and destination', async () => {
    expect(titles(await search('q=zephyr&sellerCountry=GD'))).toEqual(['Zephyr Nutmeg Jam']);
    expect(titles(await search('q=zephyr&countryOfOrigin=GD'))).toEqual(['Zephyr Nutmeg Jam']);
    // Only St. Lucia has an open lane to St. Vincent.
    expect(titles(await search('q=zephyr&destination=VC'))).toEqual(['Zephyr Baby Wipes', 'Zephyr Pepper Sauce', 'Zephyr Premium Diaper']);
  });

  it('filters by price, currency and availability, and sorts by price', async () => {
    expect(titles(await search('q=zephyr&minPrice=15&maxPrice=30'))).toEqual(['Zephyr Nutmeg Jam', 'Zephyr Pepper Sauce']);
    expect(titles(await search('q=zephyr&currency=USD'))).toEqual([]);
    expect(titles(await search('q=zephyr&inStock=true'))).not.toContain('Zephyr Baby Wipes');
    const byPrice = (await search('q=zephyr&sort=price_asc')).items.map((i: { priceFrom: { formatted: string } }) => i.priceFrom.formatted);
    expect(byPrice).toEqual(['EC$12.00', 'EC$18.00', 'EC$25.00', 'EC$60.00']);
  });

  it('paginates with a total', async () => {
    const page = await search('q=zephyr&pageSize=2&page=2&sort=price_asc');
    expect(page.total).toBe(4);
    expect(page.items).toHaveLength(2);
    expect(page.items[0].seller).toMatchObject({ country: expect.any(String), slug: expect.any(String) });
  });

  it('treats search text as data, not SQL or wildcards', async () => {
    expect((await search(`q=${encodeURIComponent("'; drop table products; --")}`)).items).toEqual([]);
    expect((await search('q=%25')).items).toEqual([]);
  });

  it('lists public sellers by country and returns categories', async () => {
    const sellers = (await request(ctx.app.getHttpServer()).get('/api/v1/sellers?country=GD')).body.items;
    expect(sellers.map((s: { name: string }) => s.name)).toEqual(['Grenada Store']);
    const cats = (await request(ctx.app.getHttpServer()).get('/api/v1/categories')).body.items;
    expect(cats.find((c: { slug: string }) => c.slug === 'baby-and-child').children.map((c: { slug: string }) => c.slug)).toContain('diapers-and-wipes');
  });
});
