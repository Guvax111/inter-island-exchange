import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { LOGISTICS_PAYMENT_DAYS, PROVIDER_REMITTANCE_DAYS } from '@iie/shared';
import { Database, DB, Tx } from '../db/db';
import { currencies, servicePartners, settlements, transactions } from '../db/schema';
import { Errors } from '../common/errors';
import { toMoneyDto } from '../common/money';
import type { RequestMeta } from '../common/request';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../payments/ledger.service';
import type { Principal } from '../rbac/principal';

type TransactionRow = typeof transactions.$inferSelect;
const DAY = 24 * 3600_000;

/**
 * What IIE is owed and owes per transaction. The payment provider remits IIE's share (fee and shipping) net 30 days
 * after the seller payout; IIE pays the logistics partner net 45 days after delivery. Recording a payment posts it
 * to the ledger.
 */
@Injectable()
export class SettlementsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  /** At delivery: IIE owes the carrier the shipping charge, due net 45. */
  async logisticsPaymentDue(tx: Tx, t: TransactionRow, partnerId: string, deliveredAt: Date) {
    if (t.shippingMinor <= 0n) return;
    await tx
      .insert(settlements)
      .values({ kind: 'LOGISTICS_PAYMENT', transactionId: t.id, partnerId, amountMinor: t.shippingMinor, currencyCode: t.transactionCurrency, dueAt: new Date(deliveredAt.getTime() + LOGISTICS_PAYMENT_DAYS * DAY) })
      .onConflictDoNothing();
  }

  /** After the seller is paid: what the provider still holds for the transaction is IIE's, due net 30. */
  async remittanceDue(tx: Tx, t: TransactionRow, paidAt = new Date()) {
    const held = await this.ledger.balance(tx, t.id, 'provider_held');
    if (held <= 0n) return;
    await tx
      .insert(settlements)
      .values({ kind: 'PROVIDER_REMITTANCE', transactionId: t.id, amountMinor: held, currencyCode: t.transactionCurrency, dueAt: new Date(paidAt.getTime() + PROVIDER_REMITTANCE_DAYS * DAY) })
      .onConflictDoNothing();
  }

  async list(principal: Principal, filter: { status?: 'DUE' | 'PAID'; kind?: 'PROVIDER_REMITTANCE' | 'LOGISTICS_PAYMENT'; overdue?: boolean }) {
    if (!principal.canGlobally('payout.approve')) throw Errors.forbidden();
    const now = new Date();
    const rows = await this.db
      .select({ s: settlements, iieId: transactions.iieId, partner: servicePartners.name, currency: currencies })
      .from(settlements)
      .innerJoin(transactions, eq(transactions.id, settlements.transactionId))
      .innerJoin(currencies, eq(currencies.code, settlements.currencyCode))
      .leftJoin(servicePartners, eq(servicePartners.id, settlements.partnerId))
      .where(
        and(
          filter.status ? eq(settlements.status, filter.status) : undefined,
          filter.kind ? eq(settlements.kind, filter.kind) : undefined,
          filter.overdue ? and(eq(settlements.status, 'DUE'), lt(settlements.dueAt, now)) : undefined,
        ),
      )
      .orderBy(asc(settlements.status), asc(settlements.dueAt))
      .limit(500);
    return {
      items: rows.map((r) => ({
        id: r.s.id,
        kind: r.s.kind,
        iieId: r.iieId,
        counterparty: r.s.kind === 'PROVIDER_REMITTANCE' ? 'Payment provider' : (r.partner ?? 'Logistics partner'),
        direction: r.s.kind === 'PROVIDER_REMITTANCE' ? 'RECEIVABLE' : 'PAYABLE',
        amount: toMoneyDto(r.s.amountMinor, r.currency),
        dueAt: r.s.dueAt,
        overdue: r.s.status === 'DUE' && r.s.dueAt < now,
        status: r.s.status,
        paidAt: r.s.paidAt,
        reference: r.s.reference,
      })),
    };
  }

  /** Records that a remittance was received or a partner payment was made, with the bank or provider reference. */
  async markPaid(principal: Principal, id: string, input: { reference: string; paidOn?: string }, meta: RequestMeta) {
    if (!principal.canGlobally('payout.approve')) throw Errors.forbidden();
    await this.db.transaction(async (tx) => {
      const [s] = await tx.select().from(settlements).where(eq(settlements.id, id)).for('update');
      if (!s) throw Errors.notFound('Settlement');
      if (s.status !== 'DUE') throw Errors.conflict('ALREADY_PAID', 'This settlement is already recorded as paid');
      const [t] = await tx.select().from(transactions).where(eq(transactions.id, s.transactionId));
      if (s.kind === 'PROVIDER_REMITTANCE') await this.ledger.remittanceReceived(tx, t!, s.amountMinor);
      else await this.ledger.logisticsPaid(tx, t!, s.amountMinor);
      const paidAt = input.paidOn ? new Date(`${input.paidOn}T12:00:00Z`) : new Date();
      await tx.update(settlements).set({ status: 'PAID', paidAt, reference: input.reference, recordedBy: principal.userId }).where(eq(settlements.id, id));
      await this.audit.record(tx, meta, { action: 'settlement.paid', entityType: 'settlement', entityId: id, after: { kind: s.kind, iieId: t!.iieId, amountMinor: s.amountMinor.toString(), reference: input.reference } });
    });
  }

  /** Totals for the weekly report: overdue, and due within the next `days`, per kind. */
  async outlook(days = 14) {
    const now = new Date();
    const horizon = new Date(now.getTime() + days * DAY);
    const rows = await this.db
      .select({
        kind: settlements.kind,
        currency: settlements.currencyCode,
        overdue: sql<string>`coalesce(sum(case when ${settlements.dueAt} < ${now} then ${settlements.amountMinor} else 0 end), 0)::text`,
        upcoming: sql<string>`coalesce(sum(case when ${settlements.dueAt} >= ${now} then ${settlements.amountMinor} else 0 end), 0)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(settlements)
      .where(and(eq(settlements.status, 'DUE'), lte(settlements.dueAt, horizon)))
      .groupBy(settlements.kind, settlements.currencyCode);
    return rows;
  }

  /** Recent settlements paid, for the weekly report. */
  paidBetween(from: Date, to: Date) {
    return this.db
      .select({ kind: settlements.kind, currency: settlements.currencyCode, total: sql<string>`coalesce(sum(${settlements.amountMinor}), 0)::text`, count: sql<number>`count(*)::int` })
      .from(settlements)
      .where(and(eq(settlements.status, 'PAID'), gte(settlements.paidAt, from), lt(settlements.paidAt, to)))
      .groupBy(settlements.kind, settlements.currencyCode);
  }
}

