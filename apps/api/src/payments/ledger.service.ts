import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { Database, DB, Tx } from '../db/db';
import { ledgerEntries, transactions } from '../db/schema';

export type LedgerAccount =
  | 'provider_held'
  | 'seller_payable'
  | 'iie_fee_revenue'
  | 'logistics_payable'
  // Phase 7: settlement and shipping on refunds
  | 'iie_cash'
  | 'iie_shipping_expense'
  | 'seller_receivable';
interface Line {
  account: LedgerAccount;
  direction: 'DEBIT' | 'CREDIT';
  amountMinor: bigint;
}

type TransactionRow = typeof transactions.$inferSelect;

/**
 * Double-entry ledger. Each posting must balance; this is checked here and again by the database when the
 * surrounding transaction commits (deferred constraint trigger).
 */
@Injectable()
export class LedgerService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async post(tx: Tx, transactionId: string, currency: string, description: string, lines: Line[]): Promise<string> {
    const nonZero = lines.filter((l) => l.amountMinor !== 0n);
    const balance = nonZero.reduce((sum, l) => sum + (l.direction === 'DEBIT' ? l.amountMinor : -l.amountMinor), 0n);
    if (balance !== 0n) throw new Error(`Unbalanced ledger posting for ${transactionId}: ${balance}`);
    const postingId = randomUUID();
    await tx.insert(ledgerEntries).values(nonZero.map((l) => ({ postingId, transactionId, currencyCode: currency, description, ...l })));
    return postingId;
  }

  /**
   * Buyer's payment captured by the provider:
   *   provider_held  DEBIT  total
   *   seller_payable CREDIT payout, iie_fee_revenue CREDIT fee, logistics_payable CREDIT shipping
   */
  capture(tx: Tx, t: TransactionRow) {
    return this.post(tx, t.id, t.transactionCurrency, `Payment captured for ${t.iieId}`, [
      { account: 'provider_held', direction: 'DEBIT', amountMinor: t.totalMinor },
      { account: 'seller_payable', direction: 'CREDIT', amountMinor: t.sellerPayoutMinor },
      { account: 'iie_fee_revenue', direction: 'CREDIT', amountMinor: t.platformFeeMinor },
      { account: 'logistics_payable', direction: 'CREDIT', amountMinor: t.shippingMinor },
    ]);
  }

  /** Full refund: the exact reverse of the capture. */
  refund(tx: Tx, t: TransactionRow) {
    return this.post(tx, t.id, t.transactionCurrency, `Full refund for ${t.iieId}`, [
      { account: 'seller_payable', direction: 'DEBIT', amountMinor: t.sellerPayoutMinor },
      { account: 'iie_fee_revenue', direction: 'DEBIT', amountMinor: t.platformFeeMinor },
      { account: 'logistics_payable', direction: 'DEBIT', amountMinor: t.shippingMinor },
      { account: 'provider_held', direction: 'CREDIT', amountMinor: t.totalMinor },
    ]);
  }

  /** Part of the payment returned to the buyer, borne by the seller: reduces what the seller is owed. */
  partialRefund(tx: Tx, t: TransactionRow, amountMinor: bigint) {
    return this.post(tx, t.id, t.transactionCurrency, `Partial refund for ${t.iieId}`, [
      { account: 'seller_payable', direction: 'DEBIT', amountMinor },
      { account: 'provider_held', direction: 'CREDIT', amountMinor },
    ]);
  }

  /** The provider pays the seller out of the funds it holds. */
  payout(tx: Tx, t: TransactionRow, amountMinor: bigint) {
    return this.post(tx, t.id, t.transactionCurrency, `Seller payout for ${t.iieId}`, [
      { account: 'seller_payable', direction: 'DEBIT', amountMinor },
      { account: 'provider_held', direction: 'CREDIT', amountMinor },
    ]);
  }

  /**
   * After a full refund of a delivered order the carrier is still owed its charge: IIE bears it as an expense, or the
   * seller owes it to IIE (recovered from later payouts).
   */
  shippingBorne(tx: Tx, t: TransactionRow, bearer: 'IIE' | 'SELLER') {
    return this.post(tx, t.id, t.transactionCurrency, `Shipping for refunded ${t.iieId} borne by ${bearer === 'IIE' ? 'IIE' : 'the seller'}`, [
      { account: bearer === 'IIE' ? 'iie_shipping_expense' : 'seller_receivable', direction: 'DEBIT', amountMinor: t.shippingMinor },
      { account: 'logistics_payable', direction: 'CREDIT', amountMinor: t.shippingMinor },
    ]);
  }

  /** Part of a payout kept back to settle what the seller owes IIE. */
  recoverFromPayout(tx: Tx, t: TransactionRow, amountMinor: bigint, description: string) {
    return this.post(tx, t.id, t.transactionCurrency, description, [
      { account: 'seller_payable', direction: 'DEBIT', amountMinor },
      { account: 'seller_receivable', direction: 'CREDIT', amountMinor },
    ]);
  }

  /** The provider remits IIE's share (fee and shipping) for a transaction. */
  remittanceReceived(tx: Tx, t: TransactionRow, amountMinor: bigint) {
    return this.post(tx, t.id, t.transactionCurrency, `Provider remittance for ${t.iieId}`, [
      { account: 'iie_cash', direction: 'DEBIT', amountMinor },
      { account: 'provider_held', direction: 'CREDIT', amountMinor },
    ]);
  }

  /** IIE pays the logistics partner for a transaction's shipping. */
  logisticsPaid(tx: Tx, t: TransactionRow, amountMinor: bigint) {
    return this.post(tx, t.id, t.transactionCurrency, `Logistics partner paid for ${t.iieId}`, [
      { account: 'logistics_payable', direction: 'DEBIT', amountMinor },
      { account: 'iie_cash', direction: 'CREDIT', amountMinor },
    ]);
  }

  /** Current balance of one account for a transaction (debits minus credits). */
  async balance(tx: Tx, transactionId: string, account: LedgerAccount): Promise<bigint> {
    const rows = await tx.select().from(ledgerEntries).where(and(eq(ledgerEntries.transactionId, transactionId), eq(ledgerEntries.account, account)));
    return rows.reduce((sum, r) => sum + (r.direction === 'DEBIT' ? r.amountMinor : -r.amountMinor), 0n);
  }

  async entries(transactionId: string) {
    const rows = await this.db.select().from(ledgerEntries).where(eq(ledgerEntries.transactionId, transactionId)).orderBy(asc(ledgerEntries.id));
    const balances = new Map<string, bigint>();
    for (const r of rows) balances.set(r.account, (balances.get(r.account) ?? 0n) + (r.direction === 'DEBIT' ? r.amountMinor : -r.amountMinor));
    return { rows, balances };
  }
}
