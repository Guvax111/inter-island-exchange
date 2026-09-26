import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { TransactionStatus } from '@iie/shared';
import { disputeMessages, payouts, refunds, transactions } from '../src/db/schema';
import { PaymentsService } from '../src/payments/payments.service';
import { TransactionEngine, type Actor } from '../src/transactions/transaction-engine';
import { Client, createActiveBuyer, createActiveSeller, createPublishedProduct, createSuperAdmin, createTestApp, lastEmailTo, TestContext, testImage } from './helpers';

let ctx: TestContext;
let admin: Client;
let seller: Awaited<ReturnType<typeof createActiveSeller>>;
const DAY = 24 * 3600_000;

beforeAll(async () => {
  ctx = await createTestApp();
  admin = (await createSuperAdmin(ctx)).client;
  seller = await createActiveSeller(ctx, admin, { name: 'Disputes Store' });
});
afterAll(() => ctx.close());

const tx = async (iieId: string) => (await ctx.db.select().from(transactions).where(eq(transactions.iieId, iieId)))[0]!;
const payoutOf = async (iieId: string) => (await ctx.db.select().from(payouts).where(eq(payouts.transactionId, (await tx(iieId)).id)))[0]!;
const money = async (iieId: string) => (await admin.get(`/admin/transactions/${iieId}/money`)).body;

/**
 * 2 x EC$45 diapers to St. Vincent (EC$149.50 paid, seller payout EC$90), paid on the sandbox and confirmed by the seller,
 * then moved to DELIVERED through the engine (the shipment journey itself is covered by the logistics tests).
 */
async function deliveredOrder() {
  const product = await createPublishedProduct(ctx, seller, admin, { variants: [{ sku: `DSP-${randomUUID().slice(0, 6)}`, name: '56 pack', price: '45.00', quantity: 10 }] });
  const buyer = await createActiveBuyer(ctx, 'VC');
  await buyer.client.post('/me/cart/items', { variantId: product.variants[0].id, quantity: 2 }).expect(201);
  const addressId = (await buyer.client.get('/me/addresses')).body.items[0].id;
  const q = (await buyer.client.post('/me/checkout/quote', { sellerSlug: seller.slug, addressId })).body;
  const iieId = (await buyer.client.post('/me/checkout', { quoteId: q.quoteId })).body.iieId as string;
  const url = new URL((await buyer.client.post(`/me/orders/${iieId}/pay`)).body.redirectUrl);
  await buyer.client.agent.post(url.pathname).set('origin', url.origin).type('form').send({ outcome: 'SUCCEED', token: url.searchParams.get('token') }).expect(303);
  await seller.client.post(`/me/sales/${iieId}/confirm`).expect(204);
  const engine = ctx.app.get(TransactionEngine);
  const steps: [TransactionStatus, Actor['type']][] = [
    ['PREPARING_SHIPMENT', 'SELLER'],
    ['PICKUP_SCHEDULED', 'ADMIN'],
    ['PICKED_UP', 'LOGISTICS'],
    ['EXPORT_PROCESSING', 'LOGISTICS'],
    ['IN_TRANSIT', 'LOGISTICS'],
    ['ARRIVED_DESTINATION', 'LOGISTICS'],
    ['CUSTOMS_PROCESSING', 'CUSTOMS'],
    ['CUSTOMS_CLEARED', 'CUSTOMS'],
    ['OUT_FOR_DELIVERY', 'LOGISTICS'],
    ['DELIVERED', 'LOGISTICS'],
  ];
  const id = (await tx(iieId)).id;
  await ctx.db.transaction(async (t) => {
    for (const [to, type] of steps) await engine.transition(t, id, to, { type }, to === 'DELIVERED' ? { set: { deliveryConfirmDueAt: new Date(Date.now() + 3 * DAY) } } : {});
  });
  return { buyer, iieId };
}

describe('review period and seller payout', () => {
  it('pays the seller 7 days after the buyer confirms delivery', async () => {
    const { buyer, iieId } = await deliveredOrder();
    await buyer.client.post(`/me/orders/${iieId}/confirm-delivery`).expect(204);
    const t = await tx(iieId);
    expect(t.status).toBe('DISPUTE_WINDOW');
    expect(t.reviewEndsAt!.getTime() - Date.now()).toBeGreaterThan(6.99 * DAY);
    const order = (await buyer.client.get(`/me/orders/${iieId}`)).body;
    expect(order).toMatchObject({ canReportProblem: true, reviewEndsAt: expect.any(String), dispute: null });

    const payments = ctx.app.get(PaymentsService);
    expect(await payments.releaseDuePayouts(new Date(Date.now() + 6 * DAY))).toBe(0);
    expect(await payments.releaseDuePayouts(new Date(Date.now() + 7 * DAY + 60_000))).toBeGreaterThanOrEqual(1);

    expect(await tx(iieId)).toMatchObject({ status: 'COMPLETED', payoutStatus: 'PAID', reviewEndsAt: null });
    expect(await payoutOf(iieId)).toMatchObject({ status: 'PAID', amountMinor: 9000n, providerPayoutId: expect.stringMatching(/^sbx_po_/) });
    const statuses = (await admin.get(`/admin/transactions/${iieId}`)).body.timeline.map((e: { status: string }) => e.status);
    expect(statuses.slice(-5)).toEqual(['DELIVERY_CONFIRMED', 'DISPUTE_WINDOW', 'PAYOUT_APPROVED', 'PAYOUT_PROCESSING', 'COMPLETED']);

    // Ledger: the seller's share left the provider; the fee and shipping remain held for settlement.
    const m = await money(iieId);
    expect(m.balanced).toBe(true);
    expect(m.balances.seller_payable.side).toBe('NONE');
    expect(m.balances.provider_held).toMatchObject({ formatted: 'EC$59.50', side: 'DEBIT' });

    await ctx.flush();
    expect(lastEmailTo(ctx, seller.email).subject).toBe(`You have been paid for ${iieId}`);
    const mine = (await seller.client.get('/me/payouts')).body.items.find((p: { iieId: string }) => p.iieId === iieId);
    expect(mine).toMatchObject({ status: 'PAID', amount: { formatted: 'EC$90.00' }, paidAt: expect.any(String) });
    // Too late to report a problem.
    expect((await buyer.client.post(`/me/orders/${iieId}/report-problem`, { reason: 'Something is wrong now' })).status).toBe(409);
  });
});

describe('disputes', () => {
  it('partial refund: messages with photo evidence, the buyer gets part back and the seller the rest', async () => {
    const { buyer, iieId } = await deliveredOrder();
    await buyer.client.post(`/me/orders/${iieId}/confirm-delivery`).expect(204);
    // Still inside the review period: the buyer can report a problem.
    await buyer.client.post(`/me/orders/${iieId}/report-problem`, { reason: 'One of the two packs was missing from the box' }).expect(204);
    expect(await tx(iieId)).toMatchObject({ status: 'DISPUTED', disputeStatus: 'OPEN' });
    await ctx.flush();
    expect(lastEmailTo(ctx, seller.email).subject).toBe(`The buyer reported a problem with ${iieId}`);

    // Buyer adds a photo; the seller answers.
    const withPhoto = await buyer.client.agent
      .post(`/api/v1/disputes/${iieId}/messages`)
      .set('x-csrf-token', buyer.client.csrf)
      .field('body', 'Photo of the opened box')
      .attach('photo', await testImage('jpeg'), 'box.jpg');
    expect(withPhoto.status).toBe(200);
    await seller.client.post(`/disputes/${iieId}/messages`, { body: 'We packed two; we accept one may have been lost in transit.' }).expect(200);
    const view = (await seller.client.get(`/disputes/${iieId}`)).body;
    expect(view).toMatchObject({ yourRole: 'SELLER', canMessage: true, status: 'DISPUTED' });
    expect(view.messages.map((m: { role: string }) => m.role)).toEqual(['BUYER', 'BUYER', 'SELLER']);
    expect(view.limits).toBeUndefined();

    // Evidence is private to the parties and IIE.
    const photo = view.messages[1].photoUrl.replace('/api/v1', '');
    expect((await seller.client.get(photo)).status).toBe(200);
    expect((await admin.get(photo)).status).toBe(200);
    expect((await (await createActiveBuyer(ctx, 'VC')).client.get(photo)).status).toBe(404);
    expect((await (await createActiveBuyer(ctx, 'VC')).client.get(`/disputes/${iieId}`)).status).toBe(404);

    // Only IIE decides; limits are enforced.
    expect((await seller.client.post(`/admin/disputes/${iieId}/decision`, { decision: 'RELEASE_TO_SELLER', note: 'Please release my payout' })).status).toBe(403);
    expect((await admin.get(`/disputes/${iieId}`)).body.limits).toMatchObject({ maxPartialRefund: { formatted: 'EC$90.00' } });
    expect((await admin.post(`/admin/disputes/${iieId}/decision`, { decision: 'PARTIAL_REFUND', refundAmount: '95.00', note: 'Refund exceeding the payout' })).body.error.code).toBe('REFUND_TOO_LARGE');
    expect((await admin.post(`/admin/disputes/${iieId}/decision`, { decision: 'PARTIAL_REFUND', note: 'No amount given here' })).body.error.code).toBe('VALIDATION_FAILED');

    const decided = await admin.post(`/admin/disputes/${iieId}/decision`, { decision: 'PARTIAL_REFUND', refundAmount: '22.50', returnRequired: false, note: 'One pack of two was missing; refunding its value.' });
    expect(decided.status).toBe(200);
    expect(decided.body).toMatchObject({ canMessage: false, decision: 'PARTIAL_REFUND', refundAmount: { formatted: 'EC$22.50' }, returnRequired: false });
    expect(decided.body.messages.at(-1)).toMatchObject({ role: 'IIE', author: 'IIE', body: expect.stringMatching(/partial refund of EC\$22\.50.*The buyer keeps the goods/) });

    expect(await tx(iieId)).toMatchObject({ status: 'COMPLETED', paymentStatus: 'PARTIALLY_REFUNDED', payoutStatus: 'PAID' });
    expect(await payoutOf(iieId)).toMatchObject({ status: 'PAID', amountMinor: 6750n });
    const [refund] = await ctx.db.select().from(refunds).where(eq(refunds.transactionId, (await tx(iieId)).id));
    expect(refund).toMatchObject({ amountMinor: 2250n, status: 'SUCCEEDED', requestedBy: 'ADMIN' });
    const m = await money(iieId);
    expect(m.balanced).toBe(true);
    expect(m.balances.seller_payable.side).toBe('NONE');
    expect(m.balances.provider_held).toMatchObject({ formatted: 'EC$59.50', side: 'DEBIT' });
    expect((await buyer.client.get(`/me/orders/${iieId}`)).body.dispute).toMatchObject({ status: 'RESOLVED', decision: 'PARTIAL_REFUND' });
    expect((await buyer.client.post(`/disputes/${iieId}/messages`, { body: 'Thanks' })).body.error.code).toBe('DISPUTE_CLOSED');
    await ctx.flush();
    expect(lastEmailTo(ctx, buyer.email).subject).toBe(`Part of your payment for ${iieId} is being refunded`);
  });

  it('full refund with the goods to be returned, decided case by case', async () => {
    const { buyer, iieId } = await deliveredOrder();
    // Reported straight after delivery, before confirming.
    await buyer.client.post(`/me/orders/${iieId}/report-problem`, { reason: 'Wrong size delivered, the packs are size 5' }).expect(204);
    expect((await admin.post(`/admin/disputes/${iieId}/decision`, { decision: 'FULL_REFUND', returnRequired: true, note: 'Wrong item shipped by the seller.' })).body.error.code).toBe('VALIDATION_FAILED');
    const res = await admin.post(`/admin/disputes/${iieId}/decision`, {
      decision: 'FULL_REFUND',
      returnRequired: true,
      returnInstructions: 'Hand the unopened packs to the IIE logistics partner in Kingstown within 7 days.',
      note: 'Wrong item shipped by the seller.',
    });
    expect(res.status).toBe(200);
    expect(await tx(iieId)).toMatchObject({ status: 'REFUNDED', paymentStatus: 'REFUNDED', payoutStatus: 'CANCELLED' });
    expect(await payoutOf(iieId)).toMatchObject({ status: 'CANCELLED' });
    const m = await money(iieId);
    expect(m.balanced).toBe(true);
    expect(Object.values(m.balances).every((b) => (b as { side: string }).side === 'NONE')).toBe(true);
    const order = (await buyer.client.get(`/me/orders/${iieId}`)).body;
    expect(order.dispute).toMatchObject({ decision: 'FULL_REFUND', refundAmount: { formatted: 'EC$149.50' }, returnRequired: true, returnInstructions: expect.stringMatching(/Kingstown/) });
  });

  it('release to the seller, and the conversation cannot be edited', async () => {
    const { buyer, iieId } = await deliveredOrder();
    await buyer.client.post(`/me/orders/${iieId}/report-problem`, { reason: 'The box arrived dented at one corner' }).expect(204);
    await admin.post(`/admin/disputes/${iieId}/decision`, { decision: 'RELEASE_TO_SELLER', note: 'Packaging damage only; the goods are fine.' }).expect(200);
    expect(await tx(iieId)).toMatchObject({ status: 'COMPLETED' });
    expect(await payoutOf(iieId)).toMatchObject({ status: 'PAID', amountMinor: 9000n });
    const list = (await admin.get('/admin/disputes?status=ALL')).body.items;
    expect(list.find((d: { iieId: string }) => d.iieId === iieId)).toMatchObject({ status: 'RESOLVED', decision: 'RELEASE_TO_SELLER' });
    expect((await admin.get('/admin/disputes')).body.items.find((d: { iieId: string }) => d.iieId === iieId)).toBeUndefined();
    const err = await ctx.db.execute(sql`update ${disputeMessages} set body = 'x'`).then(() => 'ok', (e: Error) => String((e.cause as Error)?.message ?? e.message));
    expect(err).toMatch(/append-only/);
  });
});
