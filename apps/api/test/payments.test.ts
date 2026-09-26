import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { inventory, inventoryMovements, ledgerEntries, payouts, refunds, transactions } from '../src/db/schema';
import { OrdersService } from '../src/transactions/orders.service';
import { PaymentsService } from '../src/payments/payments.service';
import { PAYMENT_PROVIDER, SandboxPaymentProvider } from '../src/payments/payment.provider';
import { Client, createActiveBuyer, createActiveSeller, createPublishedProduct, createSuperAdmin, createTestApp, TestContext } from './helpers';

let ctx: TestContext;
let admin: Client;
let seller: Awaited<ReturnType<typeof createActiveSeller>>;
const http = () => request(ctx.app.getHttpServer());

beforeAll(async () => {
  ctx = await createTestApp();
  admin = (await createSuperAdmin(ctx)).client;
  seller = await createActiveSeller(ctx, admin, { name: 'Payments Store' });
});
afterAll(() => ctx.close());

/** A St. Vincent buyer orders 2 x EC$45 diapers (total EC$149.50). */
async function placeOrder(stock = 10) {
  const product = await createPublishedProduct(ctx, seller, admin, { variants: [{ sku: `PAY-${randomUUID().slice(0, 6)}`, name: '56 pack', price: '45.00', quantity: stock }] });
  const variantId = product.variants[0].id as string;
  const buyer = await createActiveBuyer(ctx, 'VC');
  await buyer.client.post('/me/cart/items', { variantId, quantity: 2 }).expect(201);
  const addressId = (await buyer.client.get('/me/addresses')).body.items[0].id;
  const q = (await buyer.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId })).body;
  const { iieId } = (await buyer.client.post('/me/checkout', { quoteId: q.quoteId })).body;
  return { buyer, iieId: iieId as string, variantId, product };
}

/** Follows the redirect to the sandbox page and presses a button, like the buyer would. */
async function payOnSandbox(buyer: Client, iieId: string, outcome: 'SUCCEED' | 'DECLINE' | 'PROCESSING') {
  const { redirectUrl } = (await buyer.post(`/me/orders/${iieId}/pay`)).body;
  const url = new URL(redirectUrl);
  const token = url.searchParams.get('token')!;
  const page = await buyer.agent.get(url.pathname + url.search);
  expect(page.status).toBe(200);
  expect(page.headers['referrer-policy']).toBe('same-origin');
  // As a browser posts the form: with the buyer's session cookie and the site's origin, but no CSRF header.
  const res = await buyer.agent.post(url.pathname).set('origin', url.origin).type('form').send({ outcome, token });
  return { res, page, url, token };
}

const tx = async (iieId: string) => (await ctx.db.select().from(transactions).where(eq(transactions.iieId, iieId)))[0]!;
const stockOf = async (variantId: string) => (await ctx.db.select().from(inventory).where(eq(inventory.variantId, variantId)))[0]!;
const money = async (iieId: string) => (await admin.get(`/admin/transactions/${iieId}/money`)).body;
const sandbox = () => ctx.app.get(PAYMENT_PROVIDER) as SandboxPaymentProvider;
const sendWebhook = (event: Record<string, unknown>, timestamp?: number) => {
  const signed = sandbox().signedEvent(event, timestamp);
  return http().post('/api/v1/webhooks/payments/sandbox').set(signed.headers).set('content-type', 'application/json').send(signed.body.toString());
};

describe('paying for an order (sandbox provider)', () => {
  it('pays on the hosted page; stock is sold, the ledger balances, the payout is held and the seller has 48 hours', async () => {
    const { buyer, iieId, variantId } = await placeOrder();
    const { res, page } = await payOnSandbox(buyer.client, iieId, 'SUCCEED');
    expect(page.text).toContain('NO REAL MONEY');
    expect(page.text).toContain('EC$149.50 XCD');
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(new RegExp(`/orders/${iieId}\\?payment=succeed$`));

    const t = await tx(iieId);
    expect(t).toMatchObject({ status: 'AWAITING_SELLER_CONFIRMATION', paymentStatus: 'PAID' });
    expect(t.sellerConfirmDueAt!.getTime() - Date.now()).toBeGreaterThan(47.9 * 3600_000);
    expect(await stockOf(variantId)).toMatchObject({ quantityOnHand: 8, quantityReserved: 0 });
    const sale = await ctx.db.select().from(inventoryMovements).where(and(eq(inventoryMovements.variantId, variantId), eq(inventoryMovements.reason, 'SALE')));
    expect(sale).toMatchObject([{ delta: -2, quantityAfter: 8, note: iieId }]);

    const m = await money(iieId);
    expect(m.balanced).toBe(true);
    expect(m.balances).toMatchObject({
      provider_held: { formatted: 'EC$149.50', side: 'DEBIT' },
      seller_payable: { formatted: 'EC$90.00', side: 'CREDIT' },
      iie_fee_revenue: { formatted: 'EC$4.50', side: 'CREDIT' },
      logistics_payable: { formatted: 'EC$55.00', side: 'CREDIT' },
    });
    expect(m.payments[0]).toMatchObject({ provider: 'sandbox', status: 'SUCCEEDED' });
    const [payout] = await ctx.db.select().from(payouts).where(eq(payouts.transactionId, t.id));
    expect(payout).toMatchObject({ status: 'ON_HOLD', amountMinor: 9000n });

    const order = (await buyer.client.get(`/me/orders/${iieId}`)).body;
    expect(order.timeline.map((e: { status: string }) => e.status)).toEqual(['CREATED', 'AWAITING_PAYMENT', 'PAYMENT_CONFIRMED', 'AWAITING_SELLER_CONFIRMATION']);
    expect(order.canPay).toBe(false);
    await ctx.flush();
    expect(ctx.email.sent.some((e) => e.to === buyer.email && e.subject === `Payment received for ${iieId}`)).toBe(true);
    expect(ctx.email.sent.some((e) => e.to === seller.email && e.subject === `Paid order ${iieId}: please confirm`)).toBe(true);
  });

  it('reuses the open payment attempt and protects the hosted page with a token', async () => {
    const { buyer, iieId } = await placeOrder();
    const a = (await buyer.client.post(`/me/orders/${iieId}/pay`)).body.redirectUrl;
    const b = (await buyer.client.post(`/me/orders/${iieId}/pay`)).body.redirectUrl;
    expect(a).toBe(b);
    const url = new URL(a);
    expect((await http().get(`${url.pathname}?token=wrong-token-value-123456`)).status).toBe(404);
    const stranger = await createActiveBuyer(ctx, 'VC');
    expect((await stranger.client.post(`/me/orders/${iieId}/pay`)).status).toBe(404);
  });

  it('a declined card can be retried within the window', async () => {
    const { buyer, iieId } = await placeOrder();
    await payOnSandbox(buyer.client, iieId, 'DECLINE');
    expect((await tx(iieId)).status).toBe('PAYMENT_FAILED');
    expect((await buyer.client.get(`/me/orders/${iieId}`)).body).toMatchObject({ canPay: true, canCancel: true });
    await payOnSandbox(buyer.client, iieId, 'SUCCEED');
    const t = await tx(iieId);
    expect(t.status).toBe('AWAITING_SELLER_CONFIRMATION');
    expect((await money(iieId)).payments.map((p: { status: string }) => p.status).sort()).toEqual(['FAILED', 'SUCCEEDED']);
  });

  it('a pending bank transfer is not cancelled by the 30-minute expiry, and completes later', async () => {
    const { buyer, iieId } = await placeOrder();
    const { url } = await payOnSandbox(buyer.client, iieId, 'PROCESSING');
    expect((await tx(iieId)).status).toBe('PAYMENT_PROCESSING');
    await ctx.app.get(OrdersService).expireOverdue(new Date(Date.now() + 60 * 60_000));
    expect((await tx(iieId)).status).toBe('PAYMENT_PROCESSING');
    const intent = (await money(iieId)).payments[0];
    await sendWebhook({ id: `evt_${randomUUID()}`, type: 'payment.succeeded', payment_intent: intent.providerIntentId, amount_minor: '14950', currency: 'XCD' }).expect(200);
    expect((await tx(iieId)).status).toBe('AWAITING_SELLER_CONFIRMATION');
    expect(url.pathname).toContain('/sandbox-pay/');
  });
});

describe('webhooks', () => {
  it('rejects bad signatures and stale timestamps, and ignores duplicates', async () => {
    const { buyer, iieId } = await placeOrder();
    const { redirectUrl } = (await buyer.client.post(`/me/orders/${iieId}/pay`)).body;
    const providerIntentId = new URL(redirectUrl).pathname.split('/').pop()!;
    const event = { id: `evt_${randomUUID()}`, type: 'payment.succeeded', payment_intent: providerIntentId, amount_minor: '14950', currency: 'XCD' };

    const forged = await http().post('/api/v1/webhooks/payments/sandbox').set('x-sandbox-signature', `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`).send(event);
    expect(forged.body.error.code).toBe('INVALID_WEBHOOK');
    expect((await sendWebhook(event, Math.floor(Date.now() / 1000) - 3600)).body.error.code).toBe('INVALID_WEBHOOK');
    expect((await tx(iieId)).status).toBe('AWAITING_PAYMENT');

    const first = await sendWebhook(event);
    expect(first.body).toMatchObject({ duplicate: false, result: 'CONFIRMED' });
    const again = await sendWebhook(event);
    expect(again.body).toMatchObject({ duplicate: true, result: 'CONFIRMED' });
    const t = await tx(iieId);
    const lines = await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.transactionId, t.id));
    expect(lines).toHaveLength(4);
    // An out-of-order "failed" after success changes nothing.
    const late = await sendWebhook({ ...event, id: `evt_${randomUUID()}`, type: 'payment.failed' });
    expect(late.body.result).toBe('IGNORED_STATE');
    expect((await tx(iieId)).status).toBe('AWAITING_SELLER_CONFIRMATION');
  });

  it('holds the order for review when the paid amount does not match', async () => {
    const { buyer, iieId } = await placeOrder();
    const { redirectUrl } = (await buyer.client.post(`/me/orders/${iieId}/pay`)).body;
    const providerIntentId = new URL(redirectUrl).pathname.split('/').pop()!;
    const res = await sendWebhook({ id: `evt_${randomUUID()}`, type: 'payment.succeeded', payment_intent: providerIntentId, amount_minor: '100', currency: 'XCD' });
    expect(res.body.result).toBe('AMOUNT_MISMATCH_HELD');
    const t = await tx(iieId);
    expect(t).toMatchObject({ status: 'COMPLIANCE_HOLD', heldFromStatus: 'AWAITING_PAYMENT', complianceStatus: 'ON_HOLD' });
    expect(await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.transactionId, t.id))).toHaveLength(0);
  });

  it('refunds a payment that arrives after the order was cancelled', async () => {
    const { buyer, iieId, variantId } = await placeOrder();
    const { redirectUrl } = (await buyer.client.post(`/me/orders/${iieId}/pay`)).body;
    const providerIntentId = new URL(redirectUrl).pathname.split('/').pop()!;
    await ctx.app.get(OrdersService).expireOverdue(new Date(Date.now() + 31 * 60_000));
    expect((await tx(iieId)).status).toBe('CANCELLED');
    const before = await stockOf(variantId);
    const res = await sendWebhook({ id: `evt_${randomUUID()}`, type: 'payment.succeeded', payment_intent: providerIntentId, amount_minor: '14950', currency: 'XCD' });
    expect(res.body.result).toBe('LATE_PAYMENT_REFUNDED');
    const t = await tx(iieId);
    expect(t).toMatchObject({ status: 'REFUNDED', paymentStatus: 'REFUNDED' });
    const m = await money(iieId);
    expect(m.balanced).toBe(true);
    expect(Object.values(m.balances).every((b) => (b as { amountMinor: string }).amountMinor === '0')).toBe(true);
    expect(m.refunds[0]).toMatchObject({ status: 'SUCCEEDED', requestedBy: 'SYSTEM' });
    expect(await stockOf(variantId)).toEqual(before); // stock was already released on cancellation
  });
});

describe('seller confirmation', () => {
  it('seller confirms a paid order; the buyer is told', async () => {
    const { buyer, iieId } = await placeOrder();
    await payOnSandbox(buyer.client, iieId, 'SUCCEED');
    const other = await createActiveSeller(ctx, admin, { name: 'Other Seller' });
    expect((await other.client.post(`/me/sales/${iieId}/confirm`)).status).toBe(404);
    await seller.client.post(`/me/sales/${iieId}/confirm`).expect(204);
    expect((await tx(iieId))).toMatchObject({ status: 'SELLER_CONFIRMED', sellerConfirmDueAt: null });
    expect((await seller.client.post(`/me/sales/${iieId}/confirm`)).body.error.code).toBe('INVALID_TRANSITION');
    await ctx.flush();
    expect(ctx.email.sent.some((e) => e.to === buyer.email && e.subject.includes(`confirmed ${iieId}`))).toBe(true);
  });

  it('seller declines: full refund, stock back on the shelf, payout cancelled, ledger nets to zero', async () => {
    const { buyer, iieId, variantId } = await placeOrder();
    await payOnSandbox(buyer.client, iieId, 'SUCCEED');
    expect((await stockOf(variantId)).quantityOnHand).toBe(8);
    expect((await seller.client.post(`/me/sales/${iieId}/decline`, { reason: 'x' })).status).toBe(400);
    await seller.client.post(`/me/sales/${iieId}/decline`, { reason: 'Out of this size after all' }).expect(204);
    const t = await tx(iieId);
    expect(t).toMatchObject({ status: 'REFUNDED', paymentStatus: 'REFUNDED', payoutStatus: 'CANCELLED' });
    expect((await stockOf(variantId)).quantityOnHand).toBe(10);
    const [payout] = await ctx.db.select().from(payouts).where(eq(payouts.transactionId, t.id));
    expect(payout!.status).toBe('CANCELLED');
    const m = await money(iieId);
    expect(m.balanced).toBe(true);
    expect(m.balances.provider_held.amountMinor).toBe('0');
    await ctx.flush();
    expect(ctx.email.sent.some((e) => e.to === buyer.email && e.subject === `Order ${iieId} refunded`)).toBe(true);
  });

  it('refunds automatically when the seller does not confirm within 48 hours', async () => {
    const { buyer, iieId } = await placeOrder();
    await payOnSandbox(buyer.client, iieId, 'SUCCEED');
    const payments = ctx.app.get(PaymentsService);
    expect(await payments.refundUnconfirmed(new Date(Date.now() + 47 * 3600_000))).toBe(0);
    expect(await payments.refundUnconfirmed(new Date(Date.now() + 49 * 3600_000))).toBeGreaterThanOrEqual(1);
    const order = (await buyer.client.get(`/me/orders/${iieId}`)).body;
    expect(order.status).toBe('REFUNDED');
    expect(order.timeline.at(-1)).toMatchObject({ status: 'REFUNDED', reason: 'The seller did not confirm within 48 hours' });
    const t = await tx(iieId);
    const [r] = await ctx.db.select().from(refunds).where(eq(refunds.transactionId, t.id));
    expect(r).toMatchObject({ status: 'SUCCEEDED', requestedBy: 'SYSTEM', amountMinor: 14950n });
  });
});

describe('ledger integrity', () => {
  it('the database refuses unbalanced postings and edits', async () => {
    const [t] = await ctx.db.select().from(transactions).limit(1);
    const unbalanced = ctx.db.transaction(async (db) => {
      await db.insert(ledgerEntries).values({ postingId: randomUUID(), transactionId: t!.id, account: 'provider_held', direction: 'DEBIT', amountMinor: 100n, currencyCode: 'XCD', description: 'test' });
    });
    await expect(unbalanced).rejects.toThrow();
    const err = await ctx.db.execute(sql`update ${ledgerEntries} set amount_minor = 1`).then(() => 'ok', (e: Error) => String((e.cause as Error)?.message ?? e.message));
    expect(err).toMatch(/append-only/);
  });
});

describe('exchange rates', () => {
  it('records same-currency transactions at rate 1 and lets administrators add rates', async () => {
    const { iieId } = await placeOrder();
    expect(await tx(iieId)).toMatchObject({ fxRate: '1.00000000', fxSource: 'SAME_CURRENCY' });
    const seeded = (await admin.get('/admin/exchange-rates')).body.items;
    expect(seeded.find((r: { baseCurrency: string; quoteCurrency: string }) => r.baseCurrency === 'USD' && r.quoteCurrency === 'XCD').rate).toBe('2.70000000');
    await admin.post('/admin/exchange-rates', { base: 'TTD', quote: 'XCD', rate: '0.39800000', source: 'Manual (test)' }).expect(201);
    expect((await admin.post('/admin/exchange-rates', { base: 'XCD', quote: 'XCD', rate: '1', source: 'Manual test' })).body.error.code).toBe('SAME_CURRENCY');
  });
});
