import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lte } from 'drizzle-orm';
import { Database, DB } from '../db/db';
import { exchangeRates } from '../db/schema';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request';
import { AuditService } from '../audit/audit.service';

export interface FxQuote {
  rate: string;
  source: string;
  rateId: string | null;
  at: Date;
}

/**
 * Exchange rates. Rates are append-only; a transaction stores the rate it used and is never recomputed.
 * The pilot lane is XCD -> XCD, so no conversion happens yet. A live rate-feed provider can be added behind
 * this service; today rates are entered by administrators (e.g. central bank pegs).
 */
@Injectable()
export class FxService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async rate(base: string, quote: string, at = new Date()): Promise<FxQuote> {
    if (base === quote) return { rate: '1', source: 'SAME_CURRENCY', rateId: null, at };
    const [row] = await this.db
      .select()
      .from(exchangeRates)
      .where(and(eq(exchangeRates.baseCurrency, base), eq(exchangeRates.quoteCurrency, quote), lte(exchangeRates.effectiveAt, at)))
      .orderBy(desc(exchangeRates.effectiveAt))
      .limit(1);
    if (!row) throw Errors.badRequest('FX_UNAVAILABLE', `No exchange rate from ${base} to ${quote}`);
    return { rate: row.rate, source: row.source, rateId: row.id, at: row.effectiveAt };
  }

  list() {
    return this.db.select().from(exchangeRates).orderBy(desc(exchangeRates.effectiveAt)).limit(200);
  }

  async add(input: { base: string; quote: string; rate: string; source: string }, meta: RequestMeta) {
    if (input.base === input.quote) throw Errors.badRequest('SAME_CURRENCY', 'Base and quote currencies must differ');
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(exchangeRates).values({ baseCurrency: input.base, quoteCurrency: input.quote, rate: input.rate, source: input.source }).returning();
      await this.audit.record(tx, meta, { action: 'fx_rate.added', entityType: 'exchange_rate', entityId: row!.id, after: input });
      return row!;
    });
  }
}
