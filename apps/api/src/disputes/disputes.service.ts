import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { parseDecimalToMinor, type DisputeDecision, type TransactionStatus } from '@iie/shared';
import { Database, DB, Tx } from '../db/db';
import { currencies, disputeMessages, disputes, payouts, sellerProfiles, transactions, users } from '../db/schema';
import { Errors } from '../common/errors';
import { toMoneyDto } from '../common/money';
import type { RequestMeta } from '../common/request';
import { AuditService } from '../audit/audit.service';
import { EVENTS } from '../email/notification.dispatcher';
import { ShipmentsService } from '../logistics/shipments.service';
import { MediaService } from '../media/media.service';
import { OutboxService } from '../outbox/outbox.service';
import { PaymentsService } from '../payments/payments.service';
import type { Principal } from '../rbac/principal';
import { STATUS_LABELS } from '../transactions/state-machine';
import { TransactionEngine } from '../transactions/transaction-engine';

type TransactionRow = typeof transactions.$inferSelect;
type Role = 'BUYER' | 'SELLER' | 'IIE';
type Upload = { buffer: Buffer; size: number } | undefined;

/** States in which the buyer can still report a problem: after delivery, until the review period ends. */
const REPORTABLE: TransactionStatus[] = ['DELIVERED', 'DISPUTE_WINDOW'];

/**
 * Problems reported by buyers. Buyer, seller and IIE exchange messages and photo evidence; IIE decides:
 * full refund, partial refund (borne by the seller) or release to the seller, and whether the goods must be
 * returned (case by case). Refunds and payouts go through the payment provider and the ledger.
 */
@Injectable()
export class DisputesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly engine: TransactionEngine,
    private readonly payments: PaymentsService,
    private readonly shipments: ShipmentsService,
    private readonly media: MediaService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  /** The buyer reports a problem: stops the automatic confirmation and holds the payout. */
  async open(principal: Principal, iieId: string, reason: string, meta: RequestMeta) {
    const t = await this.loadTransaction(iieId);
    if (t.buyerUserId !== principal.userId) throw Errors.notFound('Order');
    if (!REPORTABLE.includes(t.status as TransactionStatus)) {
      throw Errors.conflict('INVALID_TRANSITION', 'A problem can be reported after delivery, until the review period ends');
    }
    await this.db.transaction(async (tx) => {
      await this.engine.transition(tx, t.id, 'DISPUTED', { type: 'BUYER', userId: principal.userId }, {
        reason,
        set: { deliveryConfirmDueAt: null },
        expectedVersion: t.version,
      });
      const [d] = await tx.insert(disputes).values({ transactionId: t.id, openedBy: principal.userId, reason }).returning();
      await tx.insert(disputeMessages).values({ disputeId: d!.id, authorUserId: principal.userId, authorRole: 'BUYER', body: reason });
      await this.shipments.shipmentNote(tx, t.id, 'PROBLEM_REPORTED', 'BUYER', principal.userId, reason);
      await this.audit.record(tx, meta, { action: 'dispute.opened', entityType: 'dispute', entityId: d!.id, after: { iieId: t.iieId, reason } });
    });
  }

  /** The dispute as seen by its buyer, its seller, or IIE staff for either country. */
  async view(principal: Principal, iieId: string) {
    const t = await this.loadTransaction(iieId);
    const role = await this.roleOf(principal, t);
    if (!role) throw Errors.notFound('Dispute');
    return this.shape(t, role);
  }

  /** Adds a message, optionally with one photo as evidence. Only while the dispute is open. */
  async message(principal: Principal, iieId: string, body: string, file: Upload, meta: RequestMeta) {
    const t = await this.loadTransaction(iieId);
    const role = await this.roleOf(principal, t);
    if (!role) throw Errors.notFound('Dispute');
    const [d] = await this.db.select().from(disputes).where(eq(disputes.transactionId, t.id));
    if (!d) throw Errors.notFound('Dispute');
    if (d.status !== 'OPEN') throw Errors.conflict('DISPUTE_CLOSED', 'This dispute has been decided');
    await this.db.transaction(async (tx) => {
      const evidence = file ? await this.media.storeImage(tx, principal.userId, 'DISPUTE_EVIDENCE', file) : null;
      await tx.insert(disputeMessages).values({ disputeId: d.id, authorUserId: principal.userId, authorRole: role, body, mediaId: evidence?.id ?? null });
      await this.audit.record(tx, meta, { action: 'dispute.message', entityType: 'dispute', entityId: d.id, after: { role, evidence: !!evidence } });
      // Tell the other parties.
      const [buyer] = await tx.select().from(users).where(eq(users.id, t.buyerUserId));
      const [seller] = await tx.select({ user: users }).from(sellerProfiles).innerJoin(users, eq(users.id, sellerProfiles.userId)).where(eq(sellerProfiles.id, t.sellerProfileId));
      const subject = `New message on the problem reported for ${t.iieId}`;
      if (role !== 'BUYER') await this.email(tx, buyer!, subject, 'There is a new message about the problem you reported.', `/orders/${t.iieId}`);
      if (role !== 'SELLER') await this.email(tx, seller!.user, subject, 'There is a new message about the problem the buyer reported.', `/dashboard/seller/orders/${t.iieId}`);
    });
    return this.view(principal, iieId);
  }

  /** IIE decides. Every path ends the dispute, and either refunds the buyer or pays the seller (or both, partly). */
  async decide(
    principal: Principal,
    iieId: string,
    input: { decision: DisputeDecision; refundAmount?: string; returnRequired: boolean; returnInstructions?: string; note: string },
    meta: RequestMeta,
  ) {
    const t = await this.loadTransaction(iieId);
    if (!principal.canInCountry('dispute.resolve', t.originCountryId) && !principal.canInCountry('dispute.resolve', t.destinationCountryId)) throw Errors.notFound('Dispute');
    const [d] = await this.db.select().from(disputes).where(eq(disputes.transactionId, t.id));
    if (!d || d.status !== 'OPEN' || t.status !== 'DISPUTED') throw Errors.conflict('DISPUTE_CLOSED', 'This dispute is not open');
    const [currency] = await this.db.select().from(currencies).where(eq(currencies.code, t.transactionCurrency));
    const refundMinor = input.decision === 'PARTIAL_REFUND' ? parseDecimalToMinor(input.refundAmount!, currency!.minorUnit) : input.decision === 'FULL_REFUND' ? t.totalMinor : null;
    const admin = { type: 'ADMIN' as const, userId: principal.userId };
    const reason = `IIE decision on the reported problem: ${input.note}`;

    await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(transactions).where(eq(transactions.id, t.id)).for('update');
      if (input.decision === 'FULL_REFUND') {
        // Goods stay with the buyer unless a return is required; any returned stock is put back by the seller.
        await this.payments.refundInFull(tx, locked!, reason, 'ADMIN', { restock: false });
        await this.engine.transition(tx, t.id, 'REFUNDED', admin, { reason, set: { reviewEndsAt: null } });
      } else {
        if (input.decision === 'PARTIAL_REFUND') {
          await this.payments.refundPartially(tx, locked!, refundMinor!, reason, 'ADMIN');
          await this.engine.transition(tx, t.id, 'PARTIALLY_REFUNDED', admin, { reason });
        }
        await this.engine.transition(tx, t.id, 'PAYOUT_APPROVED', admin, { reason: input.decision === 'RELEASE_TO_SELLER' ? reason : 'Remaining payout approved', set: { reviewEndsAt: null } });
        await this.payments.releasePayout(tx, t.id);
      }
      await tx
        .update(disputes)
        .set({
          status: 'RESOLVED',
          decision: input.decision,
          refundAmountMinor: refundMinor,
          returnRequired: input.returnRequired,
          returnInstructions: input.returnRequired ? input.returnInstructions! : null,
          decisionNote: input.note,
          decidedBy: principal.userId,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(disputes.id, d.id));
      await tx.insert(disputeMessages).values({ disputeId: d.id, authorUserId: principal.userId, authorRole: 'IIE', body: this.decisionText(input, refundMinor, currency!) });
      await this.audit.record(tx, meta, { action: 'dispute.decided', entityType: 'dispute', entityId: d.id, before: { status: 'OPEN' }, after: { ...input, refundMinor: refundMinor?.toString() ?? null } });
    });
    return this.view(principal, iieId);
  }

  /** Open (or all) disputes for IIE staff, limited to their countries. */
  async listForAdmin(principal: Principal, status: 'OPEN' | 'ALL') {
    const scope = principal.scopeOf('transaction.read.any');
    if (!scope) throw Errors.forbidden();
    const rows = await this.db
      .select({ d: disputes, t: transactions, currency: currencies })
      .from(disputes)
      .innerJoin(transactions, eq(transactions.id, disputes.transactionId))
      .innerJoin(currencies, eq(currencies.code, transactions.transactionCurrency))
      .where(
        and(
          status === 'OPEN' ? eq(disputes.status, 'OPEN') : undefined,
          scope === 'ALL' ? undefined : or(inArray(transactions.originCountryId, [...scope]), inArray(transactions.destinationCountryId, [...scope])),
        ),
      )
      .orderBy(desc(disputes.createdAt))
      .limit(200);
    return {
      items: rows.map((r) => ({
        iieId: r.t.iieId,
        status: r.d.status,
        decision: r.d.decision,
        reason: r.d.reason,
        total: toMoneyDto(r.t.totalMinor, r.currency),
        openedAt: r.d.createdAt,
        decidedAt: r.d.decidedAt,
      })),
    };
  }

  /** Dispute summary included in order views (null when there is none). */
  async summaryFor(t: TransactionRow) {
    const [d] = await this.db.select().from(disputes).where(eq(disputes.transactionId, t.id));
    if (!d) return null;
    const [currency] = await this.db.select().from(currencies).where(eq(currencies.code, t.transactionCurrency));
    return {
      status: d.status,
      reason: d.reason,
      decision: d.decision,
      refundAmount: d.refundAmountMinor != null ? toMoneyDto(d.refundAmountMinor, currency!) : null,
      returnRequired: d.returnRequired,
      returnInstructions: d.returnInstructions,
      decisionNote: d.decisionNote,
      decidedAt: d.decidedAt,
    };
  }

  // ------------------------------------------------------------------ helpers

  private async shape(t: TransactionRow, role: Role) {
    const [d] = await this.db.select().from(disputes).where(eq(disputes.transactionId, t.id));
    if (!d) throw Errors.notFound('Dispute');
    const rows = await this.db
      .select({ m: disputeMessages, firstName: users.firstName })
      .from(disputeMessages)
      .innerJoin(users, eq(users.id, disputeMessages.authorUserId))
      .where(eq(disputeMessages.disputeId, d.id))
      .orderBy(asc(disputeMessages.id));
    const [payout] = await this.db.select().from(payouts).where(eq(payouts.transactionId, t.id));
    const [currency] = await this.db.select().from(currencies).where(eq(currencies.code, t.transactionCurrency));
    const { status: disputeStatus, ...summary } = (await this.summaryFor(t))!;
    return {
      ...summary,
      iieId: t.iieId,
      status: t.status,
      statusLabel: STATUS_LABELS[t.status as TransactionStatus],
      disputeStatus,
      yourRole: role,
      canMessage: d.status === 'OPEN',
      openedAt: d.createdAt,
      // IIE needs these limits to decide; the buyer and seller see the outcome instead.
      ...(role === 'IIE' ? { limits: { total: toMoneyDto(t.totalMinor, currency!), maxPartialRefund: payout ? toMoneyDto(payout.amountMinor, currency!) : null } } : {}),
      messages: rows.map((r) => ({
        role: r.m.authorRole,
        // Staff names stay private; buyer and seller see "IIE".
        author: r.m.authorRole === 'IIE' ? 'IIE' : r.firstName,
        body: r.m.body,
        photoUrl: r.m.mediaId ? `/api/v1/media/${r.m.mediaId}` : null,
        at: r.m.createdAt,
      })),
    };
  }

  private decisionText(input: { decision: DisputeDecision; returnRequired: boolean; returnInstructions?: string; note: string }, refundMinor: bigint | null, currency: typeof currencies.$inferSelect) {
    const amount = refundMinor != null ? toMoneyDto(refundMinor, currency).formatted : '';
    const outcome =
      input.decision === 'FULL_REFUND'
        ? `Decision: full refund of ${amount} to the buyer.`
        : input.decision === 'PARTIAL_REFUND'
          ? `Decision: partial refund of ${amount} to the buyer; the rest of the payout goes to the seller.`
          : 'Decision: the payout is released to the seller.';
    const goods = input.returnRequired ? ` The goods must be returned: ${input.returnInstructions}` : ' The buyer keeps the goods.';
    return `${outcome}${goods} ${input.note}`;
  }

  private async roleOf(principal: Principal, t: TransactionRow): Promise<Role | null> {
    if (t.buyerUserId === principal.userId) return 'BUYER';
    const [seller] = await this.db.select().from(sellerProfiles).where(eq(sellerProfiles.id, t.sellerProfileId));
    if (seller?.userId === principal.userId) return 'SELLER';
    if (principal.canInCountry('transaction.read.any', t.originCountryId) || principal.canInCountry('transaction.read.any', t.destinationCountryId)) return 'IIE';
    return null;
  }

  private async loadTransaction(iieId: string): Promise<TransactionRow> {
    const [t] = await this.db.select().from(transactions).where(eq(transactions.iieId, iieId.toUpperCase()));
    if (!t) throw Errors.notFound('Order');
    return t;
  }

  private async email(tx: Tx, to: { email: string; firstName: string }, subject: string, message: string, path: string) {
    await this.outbox.enqueue(tx, EVENTS.transactionUpdate, { email: to.email, firstName: to.firstName, iieId: '', subject, message, path });
  }
}
