import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import type { TransactionStatus } from '@iie/shared';
import { disputeMessages, payouts, refunds, sellerCharges, settlements, transactions } from '../src/db/schema';
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
    // What the provider still holds (fee and shipping) is IIE's, remitted net 30 days after the payout.
    const [remittance] = await ctx.db.select().from(settlements).where(eq(settlements.transactionId, t.id));
    expect(remittance).toMatchObject({ kind: 'PROVIDER_REMITTANCE', amountMinor: 5950n, status: 'DUE' });
    expect(remittance!.dueAt.getTime() - Date.now()).toBeGreaterThan(29.99 * DAY);

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

    // Buyer adds a photo; the seller answers. Each writes to IIE only: they never see each other's messages.
    const withPhoto = await buyer.client.agent
      .post(`/api/v1/disputes/${iieId}/messages`)
      .set('x-csrf-token', buyer.client.csrf)
      .field('body', 'Photo of the opened box')
      .attach('photo', await testImage('jpeg'), 'box.jpg');
    expect(withPhoto.status).toBe(200);
    // A buyer cannot address the seller.
    await buyer.client.post(`/disputes/${iieId}/messages`, { body: 'Seller, please call me', audience: 'SELLER' }).expect(200);
    await seller.client.post(`/disputes/${iieId}/messages`, { body: 'We packed two; we accept one may have been lost in transit.' }).expect(200);
    let view = (await seller.client.get(`/disputes/${iieId}`)).body;
    expect(view).toMatchObject({ yourRole: 'SELLER', canMessage: true, status: 'DISPUTED', reason: expect.stringMatching(/missing/) });
    expect(view.messages.map((m: { role: string }) => m.role)).toEqual(['SELLER']);
    expect(view.limits).toBeUndefined();
    const buyerView = (await buyer.client.get(`/disputes/${iieId}`)).body;
    expect(buyerView.messages.map((m: { role: string }) => m.role)).toEqual(['BUYER', 'BUYER', 'BUYER']);
    expect(JSON.stringify(buyerView)).not.toMatch(/lost in transit/);
    await ctx.flush();
    expect(lastEmailTo(ctx, buyer.email).subject).not.toMatch(/New message/);

    // IIE sees everything and flags that it owes a reply.
    const iieView = (await admin.get(`/disputes/${iieId}`)).body;
    expect(iieView.messages.map((m: { role: string; visibleTo: string }) => `${m.role}:${m.visibleTo}`)).toEqual(['BUYER:BUYER', 'BUYER:BUYER', 'BUYER:BUYER', 'SELLER:SELLER']);
    expect((await admin.get('/admin/disputes')).body.items.find((d: { iieId: string }) => d.iieId === iieId)).toMatchObject({ awaitingIie: true });
    // The buyer's photo is private to the buyer and IIE until IIE shares it.
    const photo = buyerView.messages[1].photoUrl.replace('/api/v1', '');
    expect((await admin.get(photo)).status).toBe(200);
    expect((await seller.client.get(photo)).status).toBe(404);
    await admin.post(`/admin/disputes/${iieId}/messages/${iieView.messages[1].id}/share`).expect(200);
    expect((await seller.client.get(photo)).status).toBe(200);
    // IIE writes to the seller only, then to both.
    await admin.post(`/disputes/${iieId}/messages`, { body: 'Please send your packing record.', audience: 'SELLER' }).expect(200);
    await admin.post(`/disputes/${iieId}/messages`, { body: 'We are reviewing the evidence.' }).expect(200);
    view = (await seller.client.get(`/disputes/${iieId}`)).body;
    expect(view.messages.map((m: { role: string; author: string; body: string }) => `${m.author}: ${m.body}`)).toEqual([
      expect.stringMatching(/: We packed two/),
      'IIE: Shared from the buyer: Photo of the opened box',
      'IIE: Please send your packing record.',
      'IIE: We are reviewing the evidence.',
    ]);
    expect((await buyer.client.get(`/disputes/${iieId}`)).body.messages.at(-1).body).toBe('We are reviewing the evidence.');
    expect((await buyer.client.get(`/disputes/${iieId}`)).body.messages).toHaveLength(4);
    await ctx.flush();
    expect(lastEmailTo(ctx, buyer.email).subject).toBe(`New message from IIE about ${iieId}`);
    expect((await admin.get('/admin/disputes')).body.items.find((d: { iieId: string }) => d.iieId === iieId)).toMatchObject({ awaitingIie: false });
    expect((await (await createActiveBuyer(ctx, 'VC')).client.get(photo)).status).toBe(404);
    expect((await (await createActiveBuyer(ctx, 'VC')).client.get(`/disputes/${iieId}`)).status).toBe(404);
    expect((await seller.client.post(`/admin/disputes/${iieId}/messages/1/share`)).status).toBe(403);

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

  it('full refund with the goods to be returned; the seller bears the carrier\'s shipping', async () => {
    const { buyer, iieId } = await deliveredOrder();
    // Reported straight after delivery, before confirming.
    await buyer.client.post(`/me/orders/${iieId}/report-problem`, { reason: 'Wrong size delivered, the packs are size 5' }).expect(204);
    expect((await admin.post(`/admin/disputes/${iieId}/decision`, { decision: 'FULL_REFUND', returnRequired: true, note: 'Wrong item shipped by the seller.' })).body.error.code).toBe('VALIDATION_FAILED');
    // The carrier is still owed after a full refund: IIE must say who pays it.
    const noBearer = await admin.post(`/admin/disputes/${iieId}/decision`, { decision: 'FULL_REFUND', returnRequired: false, note: 'Wrong item shipped by the seller.' });
    expect(noBearer.body.error.code).toBe('SHIPPING_BEARER_REQUIRED');
    const res = await admin.post(`/admin/disputes/${iieId}/decision`, {
      decision: 'FULL_REFUND',
      returnRequired: true,
      returnInstructions: 'Hand the unopened packs to the IIE logistics partner in Kingstown within 7 days.',
      note: 'Wrong item shipped by the seller.',
      shippingBorneBy: 'SELLER',
    });
    expect(res.status).toBe(200);
    expect(res.body.messages.at(-1).body).toMatch(/shipping charge of EC\$55\.00 is paid by the seller/);
    expect(await tx(iieId)).toMatchObject({ status: 'REFUNDED', paymentStatus: 'REFUNDED', payoutStatus: 'CANCELLED' });
    expect(await payoutOf(iieId)).toMatchObject({ status: 'CANCELLED' });
    const m = await money(iieId);
    expect(m.balanced).toBe(true);
    // The buyer has everything back; the seller owes IIE the EC$55 IIE owes the carrier.
    expect(m.balances.provider_held.side).toBe('NONE');
    expect(m.balances.seller_receivable).toMatchObject({ formatted: 'EC$55.00', side: 'DEBIT' });
    expect(m.balances.logistics_payable).toMatchObject({ formatted: 'EC$55.00', side: 'CREDIT' });
    const [charge] = await ctx.db.select().from(sellerCharges).where(eq(sellerCharges.transactionId, (await tx(iieId)).id));
    expect(charge).toMatchObject({ kind: 'SHIPPING_AFTER_REFUND', amountMinor: 5500n, remainingMinor: 5500n, status: 'OUTSTANDING' });
    expect((await seller.client.get('/me/payouts')).body.charges.find((c: { iieId: string }) => c.iieId === iieId)).toMatchObject({ remaining: { formatted: 'EC$55.00' }, status: 'OUTSTANDING' });
    const order = (await buyer.client.get(`/me/orders/${iieId}`)).body;
    expect(order.dispute).toMatchObject({ decision: 'FULL_REFUND', refundAmount: { formatted: 'EC$149.50' }, returnRequired: true, returnInstructions: expect.stringMatching(/Kingstown/) });
    expect((await admin.get(`/disputes/${iieId}`)).body.shippingBorneBy).toBe('SELLER');
  });

  it('full refund where IIE bears the shipping', async () => {
    const { buyer, iieId } = await deliveredOrder();
    await buyer.client.post(`/me/orders/${iieId}/report-problem`, { reason: 'The parcel was left at the wrong house' }).expect(204);
    await admin.post(`/admin/disputes/${iieId}/decision`, { decision: 'FULL_REFUND', note: 'Carrier handover error; IIE covers it.', shippingBorneBy: 'IIE' }).expect(200);
    const m = await money(iieId);
    expect(m.balances.iie_shipping_expense).toMatchObject({ formatted: 'EC$55.00', side: 'DEBIT' });
    expect(m.balances.seller_receivable).toBeUndefined();
    expect(await ctx.db.select().from(sellerCharges).where(eq(sellerCharges.transactionId, (await tx(iieId)).id))).toHaveLength(0);
  });

  it('release to the seller, and the conversation cannot be edited', async () => {
    const { buyer, iieId } = await deliveredOrder();
    await buyer.client.post(`/me/orders/${iieId}/report-problem`, { reason: 'The box arrived dented at one corner' }).expect(204);
    await admin.post(`/admin/disputes/${iieId}/decision`, { decision: 'RELEASE_TO_SELLER', note: 'Packaging damage only; the goods are fine.' }).expect(200);
    expect(await tx(iieId)).toMatchObject({ status: 'COMPLETED' });
    // The EC$55 shipping the seller owes from the earlier full refund is kept back from this payout.
    expect(await payoutOf(iieId)).toMatchObject({ status: 'PAID', amountMinor: 3500n, deductedMinor: 5500n });
    expect((await ctx.db.select().from(sellerCharges).where(eq(sellerCharges.sellerProfileId, (await tx(iieId)).sellerProfileId))).every((c) => c.status === 'RECOVERED' && c.remainingMinor === 0n)).toBe(true);
    const m = await money(iieId);
    expect(m.balanced).toBe(true);
    // Held for IIE: fee EC$4.50 + shipping EC$55 + the EC$55 kept back.
    expect(m.balances.provider_held).toMatchObject({ formatted: 'EC$114.50', side: 'DEBIT' });
    expect((await seller.client.get('/me/payouts')).body.items.find((p: { iieId: string }) => p.iieId === iieId)).toMatchObject({ amount: { formatted: 'EC$35.00' }, deducted: { formatted: 'EC$55.00' } });
    const list = (await admin.get('/admin/disputes?status=ALL')).body.items;
    expect(list.find((d: { iieId: string }) => d.iieId === iieId)).toMatchObject({ status: 'RESOLVED', decision: 'RELEASE_TO_SELLER' });
    expect((await admin.get('/admin/disputes')).body.items.find((d: { iieId: string }) => d.iieId === iieId)).toBeUndefined();
    const err = await ctx.db.execute(sql`update ${disputeMessages} set body = 'x'`).then(() => 'ok', (e: Error) => String((e.cause as Error)?.message ?? e.message));
    expect(err).toMatch(/append-only/);
  });
});

describe('settlements', () => {
  it('lists what the provider owes IIE and records the remittance against the ledger', async () => {
    expect((await seller.client.get('/admin/settlements')).status).toBe(403);
    const due = (await admin.get('/admin/settlements?status=DUE&kind=PROVIDER_REMITTANCE')).body.items;
    expect(due.length).toBeGreaterThan(0);
    const item = due.find((s: { amount: { formatted: string } }) => s.amount.formatted === 'EC$114.50');
    expect(item).toMatchObject({ direction: 'RECEIVABLE', counterparty: 'Payment provider', overdue: false });
    expect((await admin.post(`/admin/settlements/${item.id}/paid`, { reference: '' })).body.error.code).toBe('VALIDATION_FAILED');
    await admin.post(`/admin/settlements/${item.id}/paid`, { reference: 'SBX-REMIT-0001', paidOn: '2026-10-30' }).expect(204);
    expect((await admin.post(`/admin/settlements/${item.id}/paid`, { reference: 'again' })).body.error.code).toBe('ALREADY_PAID');
    const m = await money(item.iieId);
    expect(m.balanced).toBe(true);
    expect(m.balances.provider_held.side).toBe('NONE');
    expect(m.balances.iie_cash).toMatchObject({ formatted: 'EC$114.50', side: 'DEBIT' });
    const paid = (await admin.get('/admin/settlements?status=PAID')).body.items.find((s: { id: string }) => s.id === item.id);
    expect(paid).toMatchObject({ status: 'PAID', reference: 'SBX-REMIT-0001', paidAt: expect.stringMatching(/^2026-10-30/) });
  });
});

describe('reviews', () => {
  it('a buyer rates a confirmed order; nothing is public until IIE approves it', async () => {
    const { buyer, iieId } = await deliveredOrder();
    // Not before the buyer confirms the delivery.
    expect((await buyer.client.get(`/me/orders/${iieId}`)).body.canReview).toBe(false);
    expect((await buyer.client.post(`/me/orders/${iieId}/review`, { rating: 5 })).body.error.code).toBe('NOT_REVIEWABLE');
    await buyer.client.post(`/me/orders/${iieId}/confirm-delivery`).expect(204);
    expect((await buyer.client.get(`/me/orders/${iieId}`)).body.canReview).toBe(true);
    expect((await buyer.client.post(`/me/orders/${iieId}/review`, { rating: 6 })).body.error.code).toBe('VALIDATION_FAILED');
    expect((await (await createActiveBuyer(ctx, 'VC')).client.post(`/me/orders/${iieId}/review`, { rating: 5 })).status).toBe(404);
    const res = await buyer.client.post(`/me/orders/${iieId}/review`, { rating: 4, title: 'Good diapers', body: 'Arrived in Kingstown in five days, well packed.' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ rating: 4, status: 'PENDING' });
    expect((await buyer.client.post(`/me/orders/${iieId}/review`, { rating: 5 })).body.error.code).toBe('ALREADY_REVIEWED');
    expect((await buyer.client.get(`/me/orders/${iieId}`)).body).toMatchObject({ canReview: false, review: { rating: 4, status: 'PENDING' } });

    // Pending reviews are not public.
    const productId = (await ctx.db.execute(sql`select oi.product_id from order_items oi join transactions t on t.order_id = oi.order_id where t.iie_id = ${iieId}`)).rows[0]!.product_id as string;
    const before = (await request(ctx.app.getHttpServer()).get(`/api/v1/products/${productId}`)).body;
    expect(before).toMatchObject({ rating: null, reviews: [] });

    // Only IIE moderates; a rejection needs a reason.
    expect((await seller.client.get('/admin/reviews')).status).toBe(403);
    const queued = (await admin.get('/admin/reviews')).body.items.find((r: { iieId: string }) => r.iieId === iieId);
    expect(queued).toMatchObject({ rating: 4, seller: 'Disputes Store', status: 'PENDING' });
    expect((await admin.post(`/admin/reviews/${queued.id}/moderate`, { decision: 'REJECT' })).body.error.code).toBe('VALIDATION_FAILED');
    await admin.post(`/admin/reviews/${queued.id}/moderate`, { decision: 'PUBLISH' }).expect(204);
    expect((await admin.post(`/admin/reviews/${queued.id}/moderate`, { decision: 'PUBLISH' })).body.error.code).toBe('ALREADY_MODERATED');

    const after = (await request(ctx.app.getHttpServer()).get(`/api/v1/products/${productId}`)).body;
    expect(after.rating).toEqual({ average: 4, count: 1 });
    expect(after.reviews[0]).toMatchObject({ rating: 4, title: 'Good diapers', reviewer: expect.stringMatching(/^\S+ \S\.$/), reviewerCountry: 'St. Vincent and the Grenadines' });
    const store = (await request(ctx.app.getHttpServer()).get(`/api/v1/sellers/${seller.slug}`)).body;
    expect(store.rating).toEqual({ average: 4, count: 1 });
    expect(store.completedTransactions).toBeGreaterThan(0);
    expect(JSON.stringify(store.reviews)).not.toMatch(/@example\.com/);
    await ctx.flush();
    expect(lastEmailTo(ctx, buyer.email).subject).toBe('Your review is published');
  });

  it('a rejected review tells the buyer why and stays private', async () => {
    const { buyer, iieId } = await deliveredOrder();
    await buyer.client.post(`/me/orders/${iieId}/confirm-delivery`).expect(204);
    await buyer.client.post(`/me/orders/${iieId}/review`, { rating: 1, body: 'Call me on 555-0100 instead of using IIE' }).expect(201);
    const queued = (await admin.get('/admin/reviews')).body.items.find((r: { iieId: string }) => r.iieId === iieId);
    await admin.post(`/admin/reviews/${queued.id}/moderate`, { decision: 'REJECT', note: 'Reviews cannot include phone numbers.' }).expect(204);
    expect((await buyer.client.get(`/me/orders/${iieId}`)).body.review).toMatchObject({ status: 'REJECTED', moderationNote: 'Reviews cannot include phone numbers.' });
    const store = (await request(ctx.app.getHttpServer()).get(`/api/v1/sellers/${seller.slug}`)).body;
    expect(store.rating.count).toBe(1);
    expect(JSON.stringify(store.reviews)).not.toMatch(/555-0100/);
  });
});
