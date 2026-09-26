import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { countries, inventory, quotes, transactionEvents, transactions, verificationLimits } from '../src/db/schema';
import { OrdersService } from '../src/transactions/orders.service';
import { TransactionEngine } from '../src/transactions/transaction-engine';
import { Client, createActiveBuyer, createActiveSeller, createPublishedProduct, createSuperAdmin, createTestApp, grantRole, register, signedIn, TestContext } from './helpers';

let ctx: TestContext;
let admin: Client;
let seller: Awaited<ReturnType<typeof createActiveSeller>>;

beforeAll(async () => {
  ctx = await createTestApp();
  admin = (await createSuperAdmin(ctx)).client;
  seller = await createActiveSeller(ctx, admin, { name: 'Checkout Store' });
});
afterAll(() => ctx.close());

async function productWithStock(quantity: number, price = '45.00', weightGrams = 1800) {
  return createPublishedProduct(ctx, seller, admin, { weightGrams, variants: [{ sku: `CK-${Math.random().toString(36).slice(2, 8)}`, name: '56 pack', price, quantity }] });
}
async function buyerWithCart(variantId: string, quantity: number) {
  const buyer = await createActiveBuyer(ctx, 'VC');
  await buyer.client.post('/me/cart/items', { variantId, quantity }).expect(201);
  const addressId = (await buyer.client.get('/me/addresses')).body.items[0].id as string;
  return { ...buyer, addressId };
}
const reserved = async (variantId: string) => (await ctx.db.select().from(inventory).where(eq(inventory.variantId, variantId)))[0]!.quantityReserved;

describe('checkout quote', () => {
  it('prices the pilot order: product + placeholder shipping + 5% fee, with estimated duties shown separately', async () => {
    const product = await productWithStock(10);
    const buyer = await buyerWithCart(product.variants[0].id, 2);
    const res = await buyer.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId: buyer.addressId });
    expect(res.status).toBe(200);
    const q = res.body;
    expect(q.shipsFrom).toBe('St. Lucia');
    expect(q.shipsTo).toBe('St. Vincent and the Grenadines');
    expect(q.weightKg).toBe(3.6);
    expect(q.productCost.formatted).toBe('EC$90.00');
    expect(q.shipping).toMatchObject({ formatted: 'EC$55.00', isPlaceholder: true }); // 2-5 kg band
    expect(q.platformFee).toMatchObject({ formatted: 'EC$4.50', percent: 5, payer: 'BUYER', chargedToBuyer: { formatted: 'EC$4.50' } });
    expect(q.total.formatted).toBe('EC$149.50');
    // CARICOM-origin goods: 0% duty; 16% VAT on (90 + 55) = 23.20, payable on arrival.
    expect(q.dutiesEstimate).toMatchObject({ formatted: 'EC$23.20', duty: { formatted: 'EC$0.00' }, vat: { formatted: 'EC$23.20' }, paidWhen: 'ON_ARRIVAL', isPlaceholder: true });
    expect(q.estimatedLandedTotal.formatted).toBe('EC$172.70');
  });

  it('lets the seller choose to absorb the fee', async () => {
    const own = await createActiveSeller(ctx, admin, { name: 'Fee Absorbing Store' });
    await own.client.patch('/me/storefront', { feePayer: 'SELLER' }).expect(200);
    const product = await createPublishedProduct(ctx, own, admin, { variants: [{ sku: 'FA-1', name: 'x', price: '45.00', quantity: 5 }] });
    const buyer = await buyerWithCart(product.variants[0].id, 2);
    const q = (await buyer.client.post('/me/checkout/quote', { sellerSlug: own.slug, addressId: buyer.addressId })).body;
    expect(q.platformFee).toMatchObject({ formatted: 'EC$4.50', payer: 'SELLER', chargedToBuyer: { formatted: 'EC$0.00' } });
    expect(q.total.formatted).toBe('EC$145.00');
    const { iieId } = (await buyer.client.post('/me/checkout', { quoteId: q.quoteId })).body;
    const sale = (await own.client.get(`/me/sales/${iieId}`)).body;
    expect(sale.amounts.sellerPayout.formatted).toBe('EC$85.50');
  });

  it('runs the validation pipeline', async () => {
    const product = await productWithStock(50);
    const buyer = await buyerWithCart(product.variants[0].id, 1);
    const other = await createActiveBuyer(ctx, 'VC');
    const otherAddress = (await other.client.get('/me/addresses')).body.items[0].id;
    expect((await buyer.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId: otherAddress })).status).toBe(404);
    expect((await other.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId: otherAddress })).body.error.code).toBe('NOTHING_TO_CHECKOUT');
    // Too heavy for every shipping band (12 x 1.8 kg > 20 kg).
    await buyer.client.patch(`/me/cart/items/${product.variants[0].id}`, { quantity: 12 }).expect(200);
    expect((await buyer.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId: buyer.addressId })).body.error.code).toBe('NO_SHIPPING_RATE');
    await buyer.client.patch(`/me/cart/items/${product.variants[0].id}`, { quantity: 1 }).expect(200);
    // Buyer limit for BASIC accounts in St. Vincent.
    const [vc] = await ctx.db.select().from(countries).where(eq(countries.isoAlpha2, 'VC'));
    await ctx.db.insert(verificationLimits).values({ countryId: vc!.id, level: 'BASIC', maxTransactionMinor: 5000n, currencyCode: 'XCD' });
    expect((await buyer.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId: buyer.addressId })).body.error.code).toBe('LIMIT_EXCEEDED');
    await ctx.db.delete(verificationLimits).where(eq(verificationLimits.countryId, vc!.id));
    // Seller suspended.
    await admin.post(`/admin/sellers/${seller.sellerId}/suspend`, { reason: 'Temporary check' }).expect(204);
    expect((await buyer.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId: buyer.addressId })).body.error.code).toBe('SELLER_UNAVAILABLE');
    await admin.post(`/admin/sellers/${seller.sellerId}/reinstate`, { reason: 'Check complete' }).expect(204);
    expect((await buyer.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId: buyer.addressId })).status).toBe(200);
  });
});

describe('placing an order', () => {
  it('creates one transaction with an IIE ID, reserves stock, empties those cart lines and notifies both sides', async () => {
    const product = await productWithStock(10);
    const variantId = product.variants[0].id;
    const buyer = await buyerWithCart(variantId, 2);
    const q = (await buyer.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId: buyer.addressId })).body;
    const placed = await buyer.client.post('/me/checkout', { quoteId: q.quoteId });
    expect(placed.status).toBe(201);
    const { iieId } = placed.body;
    expect(iieId).toMatch(/^IIE-SLU-SVG-\d{6}$/);
    expect(await reserved(variantId)).toBe(2);
    expect((await buyer.client.get('/me/cart')).body.itemCount).toBe(0);

    const order = (await buyer.client.get(`/me/orders/${iieId}`)).body;
    expect(order).toMatchObject({ status: 'AWAITING_PAYMENT', statusLabel: 'Waiting for payment', canCancel: true, subStatuses: { payment: 'PENDING', shipment: 'NOT_STARTED' } });
    expect(order.amounts.total.formatted).toBe('EC$149.50');
    expect(order.amounts).not.toHaveProperty('sellerPayout');
    expect(new Date(order.paymentDueAt).getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
    expect(order.timeline.map((e: { status: string }) => e.status)).toEqual(['CREATED', 'AWAITING_PAYMENT']);
    expect(order.items[0]).toMatchObject({ quantity: 2, unitPrice: { formatted: 'EC$45.00' }, hsCode: '961900', countryOfOrigin: 'LC' });

    // Frozen prices: a later price change does not alter the order.
    await seller.client.patch(`/me/products/${product.id}/variants/${variantId}`, { price: '99.00' }).expect(200);
    expect((await buyer.client.get(`/me/orders/${iieId}`)).body.amounts.total.formatted).toBe('EC$149.50');

    expect((await buyer.client.post('/me/checkout', { quoteId: q.quoteId })).body.error.code).toBe('QUOTE_USED');
    const bell = (await buyer.client.get('/me/notifications')).body;
    expect(bell.unread).toBeGreaterThan(0);
    expect(bell.items[0].title).toBe(`Order ${iieId} placed`);
    const sellerBell = (await seller.client.get('/me/notifications')).body;
    expect(sellerBell.items.some((n: { title: string }) => n.title === `New order ${iieId}`)).toBe(true);
    await buyer.client.post('/me/notifications/read', {}).expect(204);
    expect((await buyer.client.get('/me/notifications')).body.unread).toBe(0);
    await ctx.flush();
    expect(ctx.email.sent.some((m) => m.to === buyer.email && m.subject.includes(iieId))).toBe(true);
  });

  it('numbers transactions from one sequence', async () => {
    const product = await productWithStock(10);
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const buyer = await buyerWithCart(product.variants[0].id, 1);
      const q = (await buyer.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId: buyer.addressId })).body;
      ids.push((await buyer.client.post('/me/checkout', { quoteId: q.quoteId })).body.iieId);
    }
    const n = ids.map((id) => Number(id.split('-').pop()));
    expect(n[1]).toBe(n[0]! + 1);
  });

  it('never sells the same last unit twice', async () => {
    const product = await productWithStock(1);
    const a = await buyerWithCart(product.variants[0].id, 1);
    const b = await buyerWithCart(product.variants[0].id, 1);
    const qa = (await a.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId: a.addressId })).body;
    const qb = (await b.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId: b.addressId })).body;
    const results = await Promise.all([a.client.post('/me/checkout', { quoteId: qa.quoteId }), b.client.post('/me/checkout', { quoteId: qb.quoteId })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('STOCK_CHANGED');
    expect(await reserved(product.variants[0].id)).toBe(1);
  });

  it('refuses expired quotes', async () => {
    const product = await productWithStock(5);
    const buyer = await buyerWithCart(product.variants[0].id, 1);
    const q = (await buyer.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId: buyer.addressId })).body;
    await ctx.db.update(quotes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(quotes.id, q.quoteId));
    expect((await buyer.client.post('/me/checkout', { quoteId: q.quoteId })).body.error.code).toBe('QUOTE_EXPIRED');
  });

  it('checks out one seller and leaves the other seller in the cart', async () => {
    const other = await createActiveSeller(ctx, admin, { name: 'Other Cart Store' });
    const p1 = await productWithStock(5);
    const p2 = await createPublishedProduct(ctx, other, admin, { variants: [{ sku: 'OC-1', name: 'x', price: '10.00', quantity: 5 }] });
    const buyer = await buyerWithCart(p1.variants[0].id, 1);
    await buyer.client.post('/me/cart/items', { variantId: p2.variants[0].id, quantity: 1 }).expect(201);
    const q = (await buyer.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId: buyer.addressId })).body;
    expect(q.lines).toHaveLength(1);
    await buyer.client.post('/me/checkout', { quoteId: q.quoteId }).expect(201);
    const cart = (await buyer.client.get('/me/cart')).body;
    expect(cart.sellers.map((s: { seller: { name: string } }) => s.seller.name)).toEqual(['Other Cart Store']);
  });
});

describe('cancellation and expiry', () => {
  it('buyer can cancel while unpaid; stock is released; it cannot be cancelled twice', async () => {
    const product = await productWithStock(5);
    const buyer = await buyerWithCart(product.variants[0].id, 3);
    const q = (await buyer.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId: buyer.addressId })).body;
    const { iieId } = (await buyer.client.post('/me/checkout', { quoteId: q.quoteId })).body;
    expect(await reserved(product.variants[0].id)).toBe(3);
    const cancelled = await buyer.client.post(`/me/orders/${iieId}/cancel`, { reason: 'Ordered by mistake' });
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', canCancel: false });
    expect(await reserved(product.variants[0].id)).toBe(0);
    expect((await buyer.client.post(`/me/orders/${iieId}/cancel`, {})).body.error.code).toBe('INVALID_TRANSITION');
    const stranger = await createActiveBuyer(ctx, 'VC');
    expect((await stranger.client.post(`/me/orders/${iieId}/cancel`, {})).status).toBe(404);
  });

  it(`cancels unpaid orders after the payment window and releases the stock`, async () => {
    const product = await productWithStock(5);
    const buyer = await buyerWithCart(product.variants[0].id, 2);
    const q = (await buyer.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId: buyer.addressId })).body;
    const { iieId } = (await buyer.client.post('/me/checkout', { quoteId: q.quoteId })).body;
    const orders = ctx.app.get(OrdersService);
    expect(await orders.expireOverdue(new Date(Date.now() + 29 * 60_000))).toBe(0); // still inside the window
    expect(await orders.expireOverdue(new Date(Date.now() + 31 * 60_000))).toBeGreaterThanOrEqual(1);
    const order = (await buyer.client.get(`/me/orders/${iieId}`)).body;
    expect(order.status).toBe('CANCELLED');
    expect(order.timeline.at(-1)).toMatchObject({ status: 'CANCELLED', reason: 'Payment window expired' });
    expect(await reserved(product.variants[0].id)).toBe(0);
    await ctx.flush();
    expect(ctx.email.sent.some((m) => m.to === buyer.email && m.subject === `Order ${iieId} cancelled`)).toBe(true);
  });
});

describe('transaction engine rules', () => {
  it('refuses moves the state machine does not allow, or by the wrong actor, and records holds', async () => {
    const product = await productWithStock(5);
    const buyer = await buyerWithCart(product.variants[0].id, 1);
    const q = (await buyer.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId: buyer.addressId })).body;
    const { iieId } = (await buyer.client.post('/me/checkout', { quoteId: q.quoteId })).body;
    const [t] = await ctx.db.select().from(transactions).where(eq(transactions.iieId, iieId));
    const engine = ctx.app.get(TransactionEngine);
    const attempt = (to: string, type: string) =>
      ctx.db.transaction((tx) => engine.transition(tx, t!.id, to as never, { type: type as never })).then(
        () => 'ok',
        (e: { code?: string; message: string }) => e.code ?? e.message,
      );
    expect(await attempt('PAYMENT_CONFIRMED', 'BUYER')).toBe('FORBIDDEN'); // only the payment provider confirms payment
    expect(await attempt('DELIVERED', 'LOGISTICS')).toBe('INVALID_TRANSITION');
    expect(await attempt('COMPLIANCE_HOLD', 'COMPLIANCE')).toBe('ok');
    let [held] = await ctx.db.select().from(transactions).where(eq(transactions.id, t!.id));
    expect(held).toMatchObject({ status: 'COMPLIANCE_HOLD', heldFromStatus: 'AWAITING_PAYMENT', complianceStatus: 'ON_HOLD' });
    expect(await attempt('AWAITING_PAYMENT', 'BUYER')).toBe('FORBIDDEN');
    expect(await attempt('AWAITING_PAYMENT', 'COMPLIANCE')).toBe('ok');
    [held] = await ctx.db.select().from(transactions).where(eq(transactions.id, t!.id));
    expect(held).toMatchObject({ status: 'AWAITING_PAYMENT', heldFromStatus: null, version: 3 });
    const events = await ctx.db.select().from(transactionEvents).where(eq(transactionEvents.transactionId, t!.id));
    expect(events.map((e) => `${e.fromStatus ?? '-'}>${e.toStatus}:${e.actorType}`)).toEqual([
      '->CREATED:BUYER',
      'CREATED>AWAITING_PAYMENT:SYSTEM',
      'AWAITING_PAYMENT>COMPLIANCE_HOLD:COMPLIANCE',
      'COMPLIANCE_HOLD>AWAITING_PAYMENT:COMPLIANCE',
    ]);
  });

  it('keeps history and IDs tamper-proof', async () => {
    const dbError = (q: Promise<unknown>) => q.then(() => 'ok', (e: Error) => String((e.cause as Error)?.message ?? e.message));
    expect(await dbError(ctx.db.execute(sql`update ${transactionEvents} set to_status = 'COMPLETED'`))).toMatch(/append-only/);
    expect(await dbError(ctx.db.execute(sql`update ${transactions} set iie_id = 'IIE-XXX-YYY-000001'`))).toMatch(/immutable/);
  });
});

describe('who can see orders', () => {
  it('seller sees their sales with only the delivery town; admins see everything in their countries', async () => {
    const product = await productWithStock(5);
    const buyer = await buyerWithCart(product.variants[0].id, 1);
    const q = (await buyer.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId: buyer.addressId })).body;
    const { iieId } = (await buyer.client.post('/me/checkout', { quoteId: q.quoteId })).body;

    const sale = (await seller.client.get(`/me/sales/${iieId}`)).body;
    expect(sale.deliveryAddress).toEqual({ city: 'Castries', country: 'St. Vincent and the Grenadines' });
    expect(sale.buyer).toEqual({ firstName: 'Marie' }); // first name only, no email or phone
    expect(sale.amounts.sellerPayout.formatted).toBe('EC$45.00');
    expect((await seller.client.get('/me/sales')).body.items.some((s: { iieId: string }) => s.iieId === iieId)).toBe(true);
    const otherSeller = await createActiveSeller(ctx, admin, { name: 'Not Your Sale' });
    expect((await otherSeller.client.get(`/me/sales/${iieId}`)).status).toBe(404);

    const full = (await admin.get(`/admin/transactions/${iieId}`)).body;
    expect(full.timeline[1]).toMatchObject({ from: 'CREATED', actorType: 'SYSTEM' });
    expect((await admin.get(`/admin/transactions?q=${iieId.slice(-6)}`)).body.items[0].iieId).toBe(iieId);

    const vcAdmin = await register(ctx, { countryCode: 'VC' });
    await grantRole(ctx, vcAdmin.id, 'country_admin', 'VC');
    const gdAdmin = await register(ctx, { countryCode: 'VC' });
    await grantRole(ctx, gdAdmin.id, 'country_admin', 'GD');
    expect((await (await signedIn(ctx, vcAdmin.email)).get(`/admin/transactions/${iieId}`)).status).toBe(200);
    expect((await (await signedIn(ctx, gdAdmin.email)).get(`/admin/transactions/${iieId}`)).status).toBe(404);
    expect((await buyer.client.get('/admin/transactions')).status).toBe(403);
  });
});

describe('checkout settings', () => {
  it('super admins change the fee, rates and duty estimates; changes apply to new quotes and are audited', async () => {
    expect((await admin.get('/admin/fee-rule')).body).toMatchObject({ percent: 5, defaultPayer: 'BUYER' });
    await admin.put('/admin/fee-rule', { percent: '7.5' }).expect(200);
    const rates = (await admin.get('/admin/shipping-rates')).body.items;
    expect(rates).toHaveLength(5);
    expect(rates.every((r: { isPlaceholder: boolean }) => r.isPlaceholder)).toBe(true);
    const band = rates.find((r: { maxWeightGrams: number }) => r.maxWeightGrams === 2000);
    await admin.patch(`/admin/shipping-rates/${band.id}`, { price: '40.00', isPlaceholder: false }).expect(200);
    await admin.post('/admin/duty-estimates', { destination: 'VC', hsPrefix: '9619', caricomOriginDutyPercent: '0', otherOriginDutyPercent: '5', vatPercent: '0', notes: 'Test: zero-rated' }).expect(201);

    const product = await productWithStock(5, '45.00', 900);
    const buyer = await buyerWithCart(product.variants[0].id, 2); // 1.8 kg -> the 2 kg band
    const q = (await buyer.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId: buyer.addressId })).body;
    expect(q.shipping).toMatchObject({ formatted: 'EC$40.00', isPlaceholder: false });
    expect(q.platformFee.formatted).toBe('EC$6.75');
    expect(q.dutiesEstimate.formatted).toBe('EC$0.00');

    const audit = (await admin.get('/admin/audit-logs?entityType=fee_rule')).body.items;
    expect(audit[0]).toMatchObject({ action: 'fee_rule.updated', before: { percentBps: 500 } });
    const countryAdmin = await register(ctx, { countryCode: 'LC' });
    await grantRole(ctx, countryAdmin.id, 'country_admin', 'LC');
    expect((await (await signedIn(ctx, countryAdmin.email)).put('/admin/fee-rule', { percent: '1' })).status).toBe(403);
    await admin.put('/admin/fee-rule', { percent: '5' }).expect(200);
  });
});
