import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { Database, DB, Tx } from '../db/db';
import { ledgerEntries, transactions } from '../db/schema';

export type LedgerAccount = 'provider_held' | 'seller_payable' | 'iie_fee_revenue' | 'logistics_payable';
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

  async entries(transactionId: string) {
    const rows = await this.db.select().from(ledgerEntries).where(eq(ledgerEntries.transactionId, transactionId)).orderBy(asc(ledgerEntries.id));
    const balances = new Map<string, bigint>();
    for (const r of rows) balances.set(r.account, (balances.get(r.account) ?? 0n) + (r.direction === 'DEBIT' ? r.amountMinor : -r.amountMinor));
    return { rows, balances };
  }
}
