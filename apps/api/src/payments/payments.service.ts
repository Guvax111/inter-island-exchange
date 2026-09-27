import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { SELLER_CONFIRMATION_HOURS, type ShippingBearer, type TransactionStatus } from '@iie/shared';
import { APP_CONFIG, AppConfig } from '../config/config';
import { Database, DB, Tx } from '../db/db';
import {
  inventory,
  inventoryMovements,
  inventoryReservations,
  paymentEvents,
  paymentIntents,
  payouts,
  providerWebhooks,
  refunds,
  sellerCharges,
  sellerProfiles,
  transactions,
} from '../db/schema';
import { AppError, Errors } from '../common/errors';
import type { RequestMeta } from '../common/request';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '../rbac/principal';
import { TransactionEngine, type Actor } from '../transactions/transaction-engine';
import { SettlementsService } from '../settlements/settlements.service';
import { LedgerService } from './ledger.service';
import { PAYMENT_PROVIDER, PaymentProvider, ProviderEvent } from './payment.provider';

type TransactionRow = typeof transactions.$inferSelect;
const PAYABLE: TransactionStatus[] = ['AWAITING_PAYMENT', 'PAYMENT_PROCESSING'];

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly engine: TransactionEngine,
    private readonly ledger: LedgerService,
    private readonly settlements: SettlementsService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ buyer pays

  /** Returns the provider's hosted payment page for the order. Reuses an open attempt for the same amount. */
  async startPayment(principal: Principal, iieId: string, meta: RequestMeta) {
    const t = await this.loadByIieId(iieId);
    if (t.buyerUserId !== principal.userId) throw Errors.notFound('Order');
    if (t.paymentDueAt && t.paymentDueAt <= new Date()) throw Errors.conflict('PAYMENT_WINDOW_CLOSED', 'The payment window for this order has closed');

    return this.db.transaction(async (tx) => {
      let current = t;
      if (t.status === 'PAYMENT_FAILED') {
        current = await this.engine.transition(tx, t.id, 'AWAITING_PAYMENT', { type: 'BUYER', userId: principal.userId }, { reason: 'Buyer is retrying payment' });
      }
      if (current.status !== 'AWAITING_PAYMENT') throw Errors.conflict('NOT_PAYABLE', 'This order is not waiting for payment');

      const [open] = await tx
        .select()
        .from(paymentIntents)
        .where(and(eq(paymentIntents.transactionId, t.id), eq(paymentIntents.status, 'REQUIRES_ACTION'), eq(paymentIntents.amountMinor, t.totalMinor)))
        .orderBy(desc(paymentIntents.createdAt))
        .limit(1);
      if (open) return { redirectUrl: open.redirectUrl };

      const web = this.config.WEB_BASE_URL.replace(/\/$/, '');
      const created = await this.provider.createIntent({ reference: t.iieId, amountMinor: t.totalMinor, currency: t.transactionCurrency, returnUrl: `${web}/orders/${t.iieId}` });
      const [intent] = await tx
        .insert(paymentIntents)
        .values({ transactionId: t.id, provider: this.provider.key, providerIntentId: created.providerIntentId, amountMinor: t.totalMinor, currencyCode: t.transactionCurrency, redirectUrl: created.redirectUrl })
        .returning();
      await tx.insert(paymentEvents).values({ paymentIntentId: intent!.id, type: 'intent.created', amountMinor: t.totalMinor, currencyCode: t.transactionCurrency });
      await this.audit.record(tx, meta, { action: 'payment.started', entityType: 'transaction', entityId: t.id, after: { provider: this.provider.key, providerIntentId: created.providerIntentId } });
      return { redirectUrl: created.redirectUrl };
    });
  }

  // ------------------------------------------------------------------ provider webhooks

  /**
   * Verifies, stores and processes a provider webhook. Stored first, unique per provider event: a duplicate that was
   * already processed is acknowledged without effect. Failures leave the row unprocessed so a provider retry works.
   */
  async receiveWebhook(providerKey: string, headers: Record<string, string | string[] | undefined>, rawBody: Buffer) {
    if (providerKey !== this.provider.key) throw Errors.notFound('Payment provider');
    const event = this.provider.parseWebhook(headers, rawBody);

    const [stored] = await this.db
      .insert(providerWebhooks)
      .values({ provider: providerKey, eventId: event.eventId, eventType: event.type, payload: event.raw })
      .onConflictDoNothing()
      .returning();
    const [row] = stored
      ? [stored]
      : await this.db.select().from(providerWebhooks).where(and(eq(providerWebhooks.provider, providerKey), eq(providerWebhooks.eventId, event.eventId)));
    if (row!.processedAt) return { received: true, duplicate: true, result: row!.result };

    try {
      const result = await this.db.transaction(async (tx) => {
        const outcome = await this.handle(tx, event, row!.id);
        await tx.update(providerWebhooks).set({ processedAt: new Date(), result: outcome, error: null }).where(eq(providerWebhooks.id, row!.id));
        return outcome;
      });
      return { received: true, duplicate: false, result };
    } catch (err) {
      await this.db.update(providerWebhooks).set({ error: err instanceof Error ? err.message.slice(0, 1000) : String(err) }).where(eq(providerWebhooks.id, row!.id));
      this.logger.error(`Webhook ${event.eventId} failed: ${String(err)}`);
      throw err;
    }
  }

  private async handle(tx: Tx, event: ProviderEvent, webhookId: string): Promise<string> {
    if (event.type.startsWith('refund.')) return this.handleRefundEvent(tx, event);
    if (event.type.startsWith('payout.')) return this.handlePayoutEvent(tx, event);

    const [intent] = await tx.select().from(paymentIntents).where(eq(paymentIntents.providerIntentId, event.providerIntentId ?? '')).for('update');
    if (!intent) return 'UNKNOWN_INTENT';
    await tx.insert(paymentEvents).values({
      paymentIntentId: intent.id,
      type: event.type,
      amountMinor: event.amountMinor ?? null,
      currencyCode: event.currency ?? null,
      webhookId,
      detail: event.failureReason ? { failureReason: event.failureReason } : {},
    });
    const [t] = await tx.select().from(transactions).where(eq(transactions.id, intent.transactionId)).for('update');
    const payment: Actor = { type: 'PAYMENT' };

    switch (event.type) {
      case 'payment.processing': {
        await tx.update(paymentIntents).set({ status: 'PROCESSING', updatedAt: new Date() }).where(eq(paymentIntents.id, intent.id));
        if (t!.status !== 'AWAITING_PAYMENT') return 'IGNORED_STATE';
        await this.engine.transition(tx, t!.id, 'PAYMENT_PROCESSING', payment, { reason: 'Payment is being processed' });
        return 'PROCESSING';
      }
      case 'payment.failed': {
        await tx.update(paymentIntents).set({ status: 'FAILED', updatedAt: new Date() }).where(eq(paymentIntents.id, intent.id));
        if (!PAYABLE.includes(t!.status as TransactionStatus)) return 'IGNORED_STATE';
        await this.engine.transition(tx, t!.id, 'PAYMENT_FAILED', payment, { reason: event.failureReason ?? 'Payment declined' });
        return 'FAILED';
      }
      case 'payment.succeeded': {
        if (intent.status === 'SUCCEEDED') return 'ALREADY_SUCCEEDED';
        await tx.update(paymentIntents).set({ status: 'SUCCEEDED', updatedAt: new Date() }).where(eq(paymentIntents.id, intent.id));
        // The provider must have collected exactly what the order asked for.
        if (event.amountMinor !== intent.amountMinor || event.currency !== intent.currencyCode) {
          await this.engine.transition(tx, t!.id, 'COMPLIANCE_HOLD', { type: 'SYSTEM' }, {
            reason: 'Paid amount does not match the order',
            metadata: { expected: intent.amountMinor.toString(), received: event.amountMinor?.toString() ?? null, currency: event.currency ?? null },
          });
          return 'AMOUNT_MISMATCH_HELD';
        }
        if (t!.status === 'CANCELLED') {
          // Paid after the order had expired or been cancelled: capture is recorded, then refunded in full.
          await this.ledger.capture(tx, t!);
          await this.providerRefund(tx, intent, intent.amountMinor, 'Payment arrived after the order was cancelled', 'SYSTEM');
          await this.ledger.refund(tx, t!);
          await this.engine.transition(tx, t!.id, 'REFUNDED', { type: 'SYSTEM' }, { reason: 'Late payment refunded automatically' });
          return 'LATE_PAYMENT_REFUNDED';
        }
        if (!PAYABLE.includes(t!.status as TransactionStatus)) return 'IGNORED_STATE';
        await this.confirmPayment(tx, t!);
        return 'CONFIRMED';
      }
      default:
        return 'IGNORED_TYPE';
    }
  }

  /** Payment confirmed: stock sold, ledger posted, payout held, seller has SELLER_CONFIRMATION_HOURS to confirm. */
  private async confirmPayment(tx: Tx, t: TransactionRow) {
    await this.engine.transition(tx, t.id, 'PAYMENT_CONFIRMED', { type: 'PAYMENT' }, { reason: 'Payment received by the payment partner' });
    await this.consumeReservations(tx, t);
    await this.ledger.capture(tx, t);
    await tx.insert(payouts).values({ transactionId: t.id, sellerProfileId: t.sellerProfileId, amountMinor: t.sellerPayoutMinor, currencyCode: t.payoutCurrency }).onConflictDoNothing();
    await this.engine.transition(tx, t.id, 'AWAITING_SELLER_CONFIRMATION', { type: 'SYSTEM' }, {
      set: { sellerConfirmDueAt: new Date(Date.now() + SELLER_CONFIRMATION_HOURS * 3600_000) },
      reason: `Seller has ${SELLER_CONFIRMATION_HOURS} hours to confirm`,
    });
  }

  private async handleRefundEvent(tx: Tx, event: ProviderEvent): Promise<string> {
    const [refund] = await tx.select().from(refunds).where(eq(refunds.providerRefundId, event.providerRefundId ?? ''));
    if (!refund) return 'UNKNOWN_REFUND';
    const status = event.type === 'refund.succeeded' ? 'SUCCEEDED' : 'FAILED';
    await tx.update(refunds).set({ status, completedAt: new Date() }).where(eq(refunds.id, refund.id));
    return `REFUND_${status}`;
  }

  // ------------------------------------------------------------------ seller confirmation

  async confirmSale(principal: Principal, iieId: string, meta: RequestMeta) {
    const t = await this.loadOwnSale(principal, iieId);
    await this.db.transaction(async (tx) => {
      await this.engine.transition(tx, t.id, 'SELLER_CONFIRMED', { type: 'SELLER', userId: principal.userId }, {
        set: { sellerConfirmDueAt: null },
        reason: 'Seller confirmed the order',
        expectedVersion: t.version,
      });
      await this.audit.record(tx, meta, { action: 'sale.confirmed', entityType: 'transaction', entityId: t.id });
    });
  }

  async declineSale(principal: Principal, iieId: string, reason: string, meta: RequestMeta) {
    const t = await this.loadOwnSale(principal, iieId);
    await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(transactions).where(eq(transactions.id, t.id)).for('update');
      if (locked!.status !== 'AWAITING_SELLER_CONFIRMATION') throw Errors.conflict('INVALID_TRANSITION', 'Only paid orders waiting for your confirmation can be declined');
      await this.refundPaid(tx, locked!, `Declined by the seller: ${reason}`, 'SELLER');
      await this.engine.transition(tx, t.id, 'REFUNDED', { type: 'SELLER', userId: principal.userId }, { set: { sellerConfirmDueAt: null }, reason: `Declined by the seller: ${reason}` });
      await this.audit.record(tx, meta, { action: 'sale.declined', entityType: 'transaction', entityId: t.id, after: { reason } });
    });
  }

  /**
   * Refunds paid orders the seller did not confirm in time. Each order is refunded in its own
   * database transaction, so one failure is logged and retried next tick without blocking the rest.
   */
  async refundUnconfirmed(now = new Date(), limit = 20): Promise<number> {
    const due = await this.db
      .select({ id: transactions.id, iieId: transactions.iieId })
      .from(transactions)
      .where(and(eq(transactions.status, 'AWAITING_SELLER_CONFIRMATION'), lte(transactions.sellerConfirmDueAt, now)))
      .limit(limit);
    let refunded = 0;
    for (const { id, iieId } of due) {
      try {
        const done = await this.db.transaction(async (tx) => {
          const [t] = await tx.select().from(transactions).where(eq(transactions.id, id)).for('update', { skipLocked: true });
          // Skip it if another worker holds it, or the seller confirmed in the meantime.
          if (!t || t.status !== 'AWAITING_SELLER_CONFIRMATION' || !t.sellerConfirmDueAt || t.sellerConfirmDueAt > now) return false;
          const reason = `The seller did not confirm within ${SELLER_CONFIRMATION_HOURS} hours`;
          await this.refundPaid(tx, t, reason, 'SYSTEM');
          await this.engine.transition(tx, t.id, 'REFUNDED', { type: 'SYSTEM' }, { set: { sellerConfirmDueAt: null }, reason });
          return true;
        });
        if (done) {
          refunded++;
          this.logger.log(`Refunded unconfirmed order ${iieId}`);
        }
      } catch (err) {
        this.logger.error(`Could not refund unconfirmed order ${iieId}: ${err instanceof AppError ? JSON.stringify(err.getResponse()) : String(err)}`);
      }
    }
    return refunded;
  }

  // ------------------------------------------------------------------ refunds

  private async refundPaid(tx: Tx, t: TransactionRow, reason: string, requestedBy: string) {
    await this.refundInFull(tx, t, reason, requestedBy, { restock: true });
  }

  /** Full refund through the provider, with the reversing ledger posting; the payout is cancelled. */
  async refundInFull(tx: Tx, t: TransactionRow, reason: string, requestedBy: string, opts: { restock: boolean }) {
    const intent = await this.succeededIntent(tx, t);
    await this.providerRefund(tx, intent, intent.amountMinor, reason, requestedBy);
    await this.ledger.refund(tx, t);
    await tx.update(payouts).set({ status: 'CANCELLED', updatedAt: new Date() }).where(eq(payouts.transactionId, t.id));
    if (opts.restock) await this.returnStock(tx, t);
  }

  /**
   * After a full refund of a delivered order the carrier's charge is still owed. IIE bears it, or the seller does:
   * then it is kept back from the seller's next payouts.
   */
  async bearShipping(tx: Tx, t: TransactionRow, bearer: ShippingBearer) {
    await this.ledger.shippingBorne(tx, t, bearer);
    if (bearer === 'SELLER') {
      await tx.insert(sellerCharges).values({
        sellerProfileId: t.sellerProfileId,
        transactionId: t.id,
        kind: 'SHIPPING_AFTER_REFUND',
        amountMinor: t.shippingMinor,
        remainingMinor: t.shippingMinor,
        currencyCode: t.transactionCurrency,
        note: `Carrier shipping for ${t.iieId}, refunded in full`,
      });
    }
  }

  /**
   * Part of the payment back to the buyer (e.g. one item missing). Borne by the seller: at most the seller's payout,
   * which is reduced by the same amount.
   */
  async refundPartially(tx: Tx, t: TransactionRow, amountMinor: bigint, reason: string, requestedBy: string) {
    const [payout] = await tx.select().from(payouts).where(eq(payouts.transactionId, t.id)).for('update');
    if (!payout || payout.status !== 'ON_HOLD') throw Errors.conflict('PAYOUT_NOT_HELD', 'The seller payout is no longer held');
    if (amountMinor <= 0n || amountMinor > payout.amountMinor) {
      throw Errors.badRequest('REFUND_TOO_LARGE', 'A partial refund must be more than zero and at most the seller payout');
    }
    const intent = await this.succeededIntent(tx, t);
    await this.providerRefund(tx, intent, amountMinor, reason, requestedBy);
    await this.ledger.partialRefund(tx, t, amountMinor);
    await tx.update(payouts).set({ amountMinor: payout.amountMinor - amountMinor, updatedAt: new Date() }).where(eq(payouts.id, payout.id));
  }

  private async succeededIntent(tx: Tx, t: TransactionRow) {
    const [intent] = await tx.select().from(paymentIntents).where(and(eq(paymentIntents.transactionId, t.id), eq(paymentIntents.status, 'SUCCEEDED')));
    if (!intent) throw new AppError(HttpStatus.CONFLICT, 'NO_PAYMENT', 'There is no successful payment to refund');
    return intent;
  }

  private async providerRefund(tx: Tx, intent: typeof paymentIntents.$inferSelect, amountMinor: bigint, reason: string, requestedBy: string) {
    const [row] = await tx
      .insert(refunds)
      .values({ transactionId: intent.transactionId, paymentIntentId: intent.id, provider: intent.provider, amountMinor, currencyCode: intent.currencyCode, reason, requestedBy })
      .returning();
    // The refund row id is the idempotency key, so a retried call cannot refund twice at the provider.
    const result = await this.provider.refund({ providerIntentId: intent.providerIntentId, amountMinor, currency: intent.currencyCode, reason, idempotencyKey: row!.id });
    await tx
      .update(refunds)
      .set({ providerRefundId: result.providerRefundId, status: result.status, completedAt: result.status === 'SUCCEEDED' ? new Date() : null })
      .where(eq(refunds.id, row!.id));
    await tx.insert(paymentEvents).values({ paymentIntentId: intent.id, type: 'refund.requested', amountMinor, currencyCode: intent.currencyCode, detail: { reason, providerRefundId: result.providerRefundId } });
  }

  // ------------------------------------------------------------------ seller payouts

  /**
   * Pays the seller for a transaction in PAYOUT_APPROVED. The provider pays out of the funds it holds; when it settles
   * at once the transaction completes, otherwise it stays PAYOUT_PROCESSING until the payout webhook.
   */
  async releasePayout(tx: Tx, transactionId: string) {
    const [t] = await tx.select().from(transactions).where(eq(transactions.id, transactionId)).for('update');
    const [payout] = await tx.select().from(payouts).where(eq(payouts.transactionId, transactionId)).for('update');
    if (!t || t.status !== 'PAYOUT_APPROVED' || !payout || !['ON_HOLD', 'APPROVED', 'FAILED'].includes(payout.status)) {
      throw Errors.conflict('PAYOUT_NOT_RELEASABLE', 'This payout cannot be released now');
    }
    const [seller] = await tx.select().from(sellerProfiles).where(eq(sellerProfiles.id, payout.sellerProfileId));
    // First release only (a retried payout has already been reduced): keep back what the seller owes IIE.
    if (payout.status === 'ON_HOLD') payout.amountMinor -= await this.recoverSellerCharges(tx, t, payout);
    await tx.update(payouts).set({ status: 'APPROVED', amountMinor: payout.amountMinor, updatedAt: new Date() }).where(eq(payouts.id, payout.id));
    await this.engine.transition(tx, t.id, 'PAYOUT_PROCESSING', { type: 'SYSTEM' }, { reason: 'Payout sent to the payment provider' });
    if (payout.amountMinor === 0n) {
      await this.completePayout(tx, t.id, payout.id, null);
      return;
    }
    const result = await this.provider.payout({
      reference: t.iieId,
      amountMinor: payout.amountMinor,
      currency: payout.currencyCode,
      sellerReference: seller!.id,
      idempotencyKey: payout.id,
    });
    await tx.update(payouts).set({ status: 'PROCESSING', providerPayoutId: result.providerPayoutId, updatedAt: new Date() }).where(eq(payouts.id, payout.id));
    if (result.status === 'SUCCEEDED') await this.completePayout(tx, t.id, payout.id, result.providerPayoutId);
  }

  /**
   * Oldest charges first (e.g. shipping on an earlier full refund the seller bears), in the payout's currency, up to
   * the payout amount. The kept-back amount stays with the provider and reaches IIE in its remittance.
   */
  private async recoverSellerCharges(tx: Tx, t: TransactionRow, payout: typeof payouts.$inferSelect): Promise<bigint> {
    const open = await tx
      .select()
      .from(sellerCharges)
      .where(and(eq(sellerCharges.sellerProfileId, payout.sellerProfileId), eq(sellerCharges.status, 'OUTSTANDING'), eq(sellerCharges.currencyCode, payout.currencyCode)))
      .orderBy(asc(sellerCharges.createdAt))
      .for('update');
    let available = payout.amountMinor;
    let recovered = 0n;
    for (const charge of open) {
      if (available <= 0n) break;
      const take = charge.remainingMinor < available ? charge.remainingMinor : available;
      const [from] = await tx.select({ iieId: transactions.iieId }).from(transactions).where(eq(transactions.id, charge.transactionId));
      await this.ledger.recoverFromPayout(tx, t, take, `Kept back from ${t.iieId} payout: ${charge.kind === 'SHIPPING_AFTER_REFUND' ? 'shipping' : charge.kind} for ${from!.iieId}`);
      const remaining = charge.remainingMinor - take;
      await tx.update(sellerCharges).set({ remainingMinor: remaining, status: remaining === 0n ? 'RECOVERED' : 'OUTSTANDING', updatedAt: new Date() }).where(eq(sellerCharges.id, charge.id));
      available -= take;
      recovered += take;
    }
    if (recovered > 0n) await tx.update(payouts).set({ deductedMinor: payout.deductedMinor + recovered }).where(eq(payouts.id, payout.id));
    return recovered;
  }

  private async completePayout(tx: Tx, transactionId: string, payoutId: string, providerPayoutId: string | null) {
    const [payout] = await tx.update(payouts).set({ status: 'PAID', releasedAt: new Date(), updatedAt: new Date() }).where(eq(payouts.id, payoutId)).returning();
    const [t] = await tx.select().from(transactions).where(eq(transactions.id, transactionId));
    if (payout!.amountMinor > 0n) await this.ledger.payout(tx, t!, payout!.amountMinor);
    // What the provider still holds (fee, shipping, anything kept back) is IIE's, remitted net 30.
    await this.settlements.remittanceDue(tx, t!);
    await this.engine.transition(tx, transactionId, 'COMPLETED', { type: 'PAYMENT' }, {
      reason: 'Seller paid',
      metadata: { providerPayoutId, amountMinor: payout!.amountMinor.toString() },
    });
  }

  /**
   * Ends review periods that have run out: the payout is approved and released. One database transaction per order,
   * so one failure is logged and retried on the next tick without blocking the rest.
   */
  async releaseDuePayouts(now = new Date(), limit = 20): Promise<number> {
    const due = await this.db
      .select({ id: transactions.id, iieId: transactions.iieId })
      .from(transactions)
      .where(and(eq(transactions.status, 'DISPUTE_WINDOW'), lte(transactions.reviewEndsAt, now)))
      .limit(limit);
    let released = 0;
    for (const { id, iieId } of due) {
      try {
        const done = await this.db.transaction(async (tx) => {
          const [t] = await tx.select().from(transactions).where(eq(transactions.id, id)).for('update', { skipLocked: true });
          if (!t || t.status !== 'DISPUTE_WINDOW' || !t.reviewEndsAt || t.reviewEndsAt > now) return false;
          await this.engine.transition(tx, t.id, 'PAYOUT_APPROVED', { type: 'SYSTEM' }, { reason: 'Review period ended without a problem reported', set: { reviewEndsAt: null } });
          await this.releasePayout(tx, t.id);
          return true;
        });
        if (done) {
          released++;
          this.logger.log(`Released payout for ${iieId}`);
        }
      } catch (err) {
        this.logger.error(`Could not release payout for ${iieId}: ${err instanceof AppError ? JSON.stringify(err.getResponse()) : String(err)}`);
      }
    }
    return released;
  }

  /** IIE retries a payout the provider reported as failed. */
  async retryPayout(iieId: string, meta: RequestMeta) {
    const t = await this.loadByIieId(iieId);
    await this.db.transaction(async (tx) => {
      const [payout] = await tx.select().from(payouts).where(eq(payouts.transactionId, t.id));
      if (payout?.status !== 'FAILED' || t.status !== 'PAYOUT_PROCESSING') throw Errors.conflict('PAYOUT_NOT_FAILED', 'Only a failed payout can be retried');
      await this.engine.transition(tx, t.id, 'PAYOUT_APPROVED', { type: 'ADMIN', userId: meta.actorUserId ?? null }, { reason: 'Payout retried by IIE' });
      await this.releasePayout(tx, t.id);
      await this.audit.record(tx, meta, { action: 'payout.retried', entityType: 'transaction', entityId: t.id });
    });
  }

  private async handlePayoutEvent(tx: Tx, event: ProviderEvent): Promise<string> {
    const [payout] = await tx.select().from(payouts).where(eq(payouts.providerPayoutId, event.providerPayoutId ?? '')).for('update');
    if (!payout) return 'UNKNOWN_PAYOUT';
    if (payout.status !== 'PROCESSING') return 'IGNORED_STATE';
    if (event.type === 'payout.succeeded') {
      await this.completePayout(tx, payout.transactionId, payout.id, payout.providerPayoutId);
      return 'PAYOUT_PAID';
    }
    await tx.update(payouts).set({ status: 'FAILED', updatedAt: new Date() }).where(eq(payouts.id, payout.id));
    return 'PAYOUT_FAILED';
  }

  // ------------------------------------------------------------------ stock

  /** On payment: reserved units become sold units (on-hand and reserved both decrease), recorded as SALE. */
  private async consumeReservations(tx: Tx, t: TransactionRow) {
    const open = await tx
      .select()
      .from(inventoryReservations)
      .where(and(eq(inventoryReservations.transactionId, t.id), isNull(inventoryReservations.releasedAt), isNull(inventoryReservations.consumedAt)));
    for (const r of open) {
      const [inv] = await tx
        .update(inventory)
        .set({
          quantityOnHand: sql`${inventory.quantityOnHand} - ${r.quantity}`,
          quantityReserved: sql`${inventory.quantityReserved} - ${r.quantity}`,
          updatedAt: new Date(),
        })
        .where(eq(inventory.variantId, r.variantId))
        .returning();
      await tx.insert(inventoryMovements).values({ variantId: r.variantId, delta: -r.quantity, quantityAfter: inv!.quantityOnHand, reason: 'SALE', note: t.iieId });
      await tx.update(inventoryReservations).set({ consumedAt: new Date() }).where(eq(inventoryReservations.id, r.id));
    }
  }

  /** Refunded before shipping: sold units go back on the shelf, recorded as RETURN. */
  private async returnStock(tx: Tx, t: TransactionRow) {
    const sold = await tx.select().from(inventoryReservations).where(and(eq(inventoryReservations.transactionId, t.id), sql`${inventoryReservations.consumedAt} is not null`));
    for (const r of sold) {
      const [inv] = await tx
        .update(inventory)
        .set({ quantityOnHand: sql`${inventory.quantityOnHand} + ${r.quantity}`, updatedAt: new Date() })
        .where(eq(inventory.variantId, r.variantId))
        .returning();
      await tx.insert(inventoryMovements).values({ variantId: r.variantId, delta: r.quantity, quantityAfter: inv!.quantityOnHand, reason: 'RETURN', note: `${t.iieId} refunded before shipping` });
    }
  }

  // ------------------------------------------------------------------ reads

  async paymentSummary(transactionId: string) {
    const intents = await this.db.select().from(paymentIntents).where(eq(paymentIntents.transactionId, transactionId)).orderBy(desc(paymentIntents.createdAt));
    const refundRows = await this.db.select().from(refunds).where(eq(refunds.transactionId, transactionId));
    const events = intents.length
      ? await this.db.select().from(paymentEvents).where(inArray(paymentEvents.paymentIntentId, intents.map((i) => i.id)))
      : [];
    return { intents, refunds: refundRows, events };
  }

  private async loadByIieId(iieId: string): Promise<TransactionRow> {
    const [t] = await this.db.select().from(transactions).where(eq(transactions.iieId, iieId.toUpperCase()));
    if (!t) throw Errors.notFound('Order');
    return t;
  }

  private async loadOwnSale(principal: Principal, iieId: string) {
    const t = await this.loadByIieId(iieId);
    const [seller] = await this.db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, principal.userId));
    if (!seller || t.sellerProfileId !== seller.id) throw Errors.notFound('Order');
    return t;
  }
}
