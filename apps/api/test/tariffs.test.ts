import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { orderItems, orders, transactions } from '../src/db/schema';
import { Client, createActiveBuyer, createActiveSeller, createPublishedProduct, createSuperAdmin, createTestApp, TestContext } from './helpers';

let ctx: TestContext;
let admin: Client;
let seller: Awaited<ReturnType<typeof createActiveSeller>>;
const http = () => request(ctx.app.getHttpServer());

// Test fixture only: invented rates for HS codes the other tests do not use. Real schedules are imported by IIE.
const FIXTURE_CSV = [
  'TEST FIXTURE - not real tariff data',
  'HS Code,Description of Goods,CET Rate of Duty %,VAT,Restriction,Remarks',
  '33.04,"Beauty or make-up preparations and preparations for the care of the skin",,,,',
  '3304.99.10,Skin creams and lotions,20,12.5,,test',
  '4202.21.10,Handbags with outer surface of leather,15,,,',
  '4202.21.90,Handbags of other leather,25,,,',
  '9301.10,Artillery weapons,,,Prohibited,',
].join('\n');

function importFile(body: Buffer, fields: Record<string, string>, name = 'cet.csv') {
  let req = admin.agent.post('/api/v1/admin/tariffs/imports').set('x-csrf-token', admin.csrf);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach('file', body, name);
}

beforeAll(async () => {
  ctx = await createTestApp();
  admin = (await createSuperAdmin(ctx)).client;
  seller = await createActiveSeller(ctx, admin, { name: 'Tariff Test Store' });
});
afterAll(() => ctx.close());

describe('tariff schedules', () => {
  let importId: string;

  it('imports a CET file as a draft for the chosen countries, reporting what it skipped', async () => {
    expect((await importFile(Buffer.from('HS,Description\n9619,x'), { name: 'Bad', source: 'Test', effectiveFrom: '2026-10-01', countryCodes: 'VC' })).body.error).toMatchObject({ code: 'UNREADABLE_TARIFF' });
    const res = await importFile(Buffer.from(FIXTURE_CSV), { name: 'CARICOM CET (test fixture)', source: 'IIE test suite', effectiveFrom: '2026-10-01', countryCodes: 'VC,LC' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    importId = res.body.id;
    expect(res.body).toMatchObject({
      status: 'DRAFT',
      summary: { layout: 'SINGLE_RATE_COLUMN', rowsRead: 5, linesByCountry: { VC: 5, LC: 5 }, withoutRate: { VC: 2 }, caricomDefaultPercent: 0 },
      schedules: expect.arrayContaining([expect.objectContaining({ country: 'VC', status: 'DRAFT', lines: 5 })]),
    });
    // Drafts do not apply yet: without an active schedule, IIE's estimate rule answers.
    const before = (await http().get('/api/v1/tariffs/lookup?country=VC&hs=330499&origin=US')).body.result;
    expect(before.source.kind).toBe('IIE_ESTIMATE');
    // Only administrators import.
    expect((await seller.client.get('/admin/tariffs/imports')).status).toBe(403);
  });

  it('activates it, and lookups give the description, the duty for the origin and the VAT', async () => {
    await admin.post(`/admin/tariffs/imports/${importId}/activate`).expect(200);
    const fromUs = (await http().get('/api/v1/tariffs/lookup?country=VC&hs=3304.99.10&origin=US')).body.result;
    expect(fromUs).toMatchObject({
      country: { code: 'VC' },
      matchedHsCode: '33049910',
      description: 'Skin creams and lotions',
      generalDutyPercent: 20,
      caricomDutyPercent: 0,
      applicableDutyPercent: 20,
      vatPercent: 12.5,
      vatFrom: 'TARIFF',
      restriction: 'NONE',
      source: { kind: 'TARIFF_SCHEDULE', name: 'CARICOM CET (test fixture)' },
    });
    expect((await http().get('/api/v1/tariffs/lookup?country=VC&hs=33049910&origin=LC')).body.result.applicableDutyPercent).toBe(0);
    // A 6-digit code covering national lines with different rates: the highest, flagged as varying.
    expect((await http().get('/api/v1/tariffs/lookup?country=VC&hs=420221')).body.result).toMatchObject({ generalDutyPercent: 25, varies: true });
    expect((await http().get('/api/v1/tariffs/lookup?country=VC&hs=930110')).body.result.restriction).toBe('PROHIBITED');
    const byWords = (await http().get('/api/v1/tariffs/search?country=VC&q=handbags leather')).body.items;
    expect(byWords.map((l: { hsCode: string }) => l.hsCode)).toEqual(['42022110', '42022190']);
    expect((await http().get('/api/v1/tariffs/search?country=LC&q=3304')).body.items).toHaveLength(2);
    expect((await http().get('/api/v1/tariffs/coverage')).body.items.map((c: { country: string }) => c.country)).toEqual(expect.arrayContaining(['LC', 'VC']));
  });

  it('shows the tariff on the product page and prices the duty at checkout with it', async () => {
    const product = await createPublishedProduct(ctx, seller, admin, {
      hsCode: '3304.99.10',
      countryOfOrigin: 'US',
      categorySlug: 'diapers-and-wipes',
      variants: [{ sku: `CRM-${randomUUID().slice(0, 6)}`, name: '200 ml', price: '40.00', quantity: 10 }],
    });
    const page = (await http().get(`/api/v1/products/${product.id}`)).body;
    expect(page.importInfo).toEqual([
      expect.objectContaining({ destination: { code: 'VC', name: 'St. Vincent and the Grenadines' }, tariff: expect.objectContaining({ description: 'Skin creams and lotions', applicableDutyPercent: 20, vatPercent: 12.5 }) }),
    ]);

    const buyer = await createActiveBuyer(ctx, 'VC');
    await buyer.client.post('/me/cart/items', { variantId: product.variants[0].id, quantity: 1 }).expect(201);
    const addressId = (await buyer.client.get('/me/addresses')).body.items[0].id;
    const q = (await buyer.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId })).body;
    // Dutiable value = 40.00 + shipping; duty 20%, then VAT 12.5% on value + duty.
    const shipping = Number(q.shipping.amountMinor) / 100;
    const duty = Math.round((40 + shipping) * 20) / 100;
    const vat = Math.round((40 + shipping + duty) * 12.5) / 100;
    expect(q.dutiesEstimate).toMatchObject({ isPlaceholder: false, duty: { formatted: `EC$${duty.toFixed(2)}` }, vat: { formatted: `EC$${vat.toFixed(2)}` } });
    expect(q.lines[0].tariff).toMatchObject({ hsCode: '33049910', description: 'Skin creams and lotions', dutyPercent: 20, vatPercent: 12.5, kind: 'TARIFF_SCHEDULE' });

    const { iieId } = (await buyer.client.post('/me/checkout', { quoteId: q.quoteId })).body;
    const order = (await buyer.client.get(`/me/orders/${iieId}`)).body;
    expect(order.items[0].tariff).toMatchObject({ description: 'Skin creams and lotions', dutyPercent: 20, source: 'CARICOM CET (test fixture)' });
    const [t] = await ctx.db.select().from(transactions).where(eq(transactions.iieId, iieId));
    const [o] = await ctx.db.select().from(orders).where(eq(orders.id, t!.orderId));
    expect((await ctx.db.select().from(orderItems).where(eq(orderItems.orderId, o!.id)))[0]).toMatchObject({ tariffHsCode: '33049910', dutyRateBps: 2000, vatRateBps: 1250 });
  });

  it('refuses checkout for goods the destination prohibits', async () => {
    const product = await createPublishedProduct(ctx, seller, admin, { hsCode: '9301.10.00', variants: [{ sku: `PRH-${randomUUID().slice(0, 6)}`, name: 'x', price: '10.00', quantity: 5 }] });
    const buyer = await createActiveBuyer(ctx, 'VC');
    await buyer.client.post('/me/cart/items', { variantId: product.variants[0].id, quantity: 1 }).expect(201);
    const addressId = (await buyer.client.get('/me/addresses')).body.items[0].id;
    const q = await buyer.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId });
    expect(q.body.error).toMatchObject({ code: 'NOT_IMPORTABLE', message: expect.stringMatching(/cannot be imported into St. Vincent/) });
  });

  it('an Excel file with one rate column per country replaces that country\'s schedule', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Notes').addRow(['Cover sheet']);
    const ws = wb.addWorksheet('Tariff');
    ws.addRow(['HS Code', 'Description', 'St. Vincent', 'CARICOM']);
    const row = ws.addRow(['3304.99.10', 'Skin creams and lotions (revised)', 0.15, 0]);
    row.getCell(3).numFmt = '0%';
    ws.addRow(['4202.21', 'Handbags of leather', 0.25, 0]).getCell(3).numFmt = '0%';
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await importFile(buffer, { name: 'SVG tariff 2027 (test fixture)', source: 'IIE test suite', effectiveFrom: '2027-01-01' }, 'svg.xlsx');
    expect(res.status).toBe(201);
    expect(res.body.summary).toMatchObject({ layout: 'ONE_RATE_COLUMN_PER_COUNTRY', linesByCountry: { VC: 2 } });
    await admin.post(`/admin/tariffs/imports/${res.body.id}/activate`).expect(200);
    const vc = (await http().get('/api/v1/tariffs/lookup?country=VC&hs=33049910&origin=US')).body.result;
    expect(vc).toMatchObject({ description: 'Skin creams and lotions (revised)', applicableDutyPercent: 15, source: { name: 'SVG tariff 2027 (test fixture)' } });
    // St. Lucia keeps the earlier schedule.
    expect((await http().get('/api/v1/tariffs/lookup?country=LC&hs=33049910&origin=US')).body.result.source.name).toBe('CARICOM CET (test fixture)');
    const first = (await admin.get(`/admin/tariffs/imports/${importId}`)).body;
    expect(first.schedules.find((s: { country: string }) => s.country === 'VC').status).toBe('RETIRED');
    // A draft can be discarded; active ones cannot.
    const draft = (await importFile(Buffer.from(FIXTURE_CSV), { name: 'Draft', source: 'Test', effectiveFrom: '2027-01-01', countryCodes: 'VC' })).body;
    await admin.post(`/admin/tariffs/imports/${draft.id}/discard`).expect(204);
    expect((await admin.post(`/admin/tariffs/imports/${res.body.id}/discard`)).body.error.code).toBe('NOT_DRAFT');
  });
});
