import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, asc, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { parseDecimalToMinor, type dutyEstimateSchema, type dutyEstimateUpdateSchema, type feeRuleUpdateSchema, type shippingRateSchema, type shippingRateUpdateSchema } from '@iie/shared';
import { Database, DB } from '../db/db';
import { countries, currencies, dutyEstimates, feeRules, laneShippingRates, lanes } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { toMoneyDto } from '../common/money';
import type { RequestMeta } from '../common/request';

const pct = (v: string) => Number(parseDecimalToMinor(v, 2)); // "16.5" -> 1650 basis points

/** Administrator-managed checkout configuration: shipping rates, the platform fee and duty estimates. */
@Injectable()
export class CheckoutSettingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async listShippingRates() {
    const origin = aliasedTable(countries, 'origin');
    const destination = aliasedTable(countries, 'destination');
    const rows = await this.db
      .select({ rate: laneShippingRates, origin: origin.isoAlpha2, destination: destination.isoAlpha2, currency: currencies })
      .from(laneShippingRates)
      .innerJoin(lanes, eq(lanes.id, laneShippingRates.laneId))
      .innerJoin(origin, eq(origin.id, lanes.originCountryId))
      .innerJoin(destination, eq(destination.id, lanes.destinationCountryId))
      .innerJoin(currencies, eq(currencies.code, laneShippingRates.currencyCode))
      .orderBy(asc(origin.isoAlpha2), asc(destination.isoAlpha2), asc(laneShippingRates.maxWeightGrams));
    return rows.map((r) => ({
      id: r.rate.id,
      origin: r.origin,
      destination: r.destination,
      serviceName: r.rate.serviceName,
      maxWeightGrams: r.rate.maxWeightGrams,
      price: toMoneyDto(r.rate.priceMinor, r.currency),
      isPlaceholder: r.rate.isPlaceholder,
      active: r.rate.active,
    }));
  }

  async addShippingRate(input: z.infer<typeof shippingRateSchema>, meta: RequestMeta) {
    const lane = await this.findLane(input.origin, input.destination);
    const [origin] = await this.db.select({ currency: countries.currencyCode }).from(countries).where(eq(countries.id, lane.originCountryId));
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(laneShippingRates)
        .values({
          laneId: lane.id,
          serviceName: input.serviceName,
          maxWeightGrams: input.maxWeightGrams,
          priceMinor: parseDecimalToMinor(input.price, 2),
          currencyCode: origin!.currency,
          isPlaceholder: input.isPlaceholder,
          active: input.active,
        })
        .returning();
      await this.audit.record(tx, meta, { action: 'shipping_rate.created', entityType: 'shipping_rate', entityId: row!.id, after: input });
    });
    return this.listShippingRates();
  }

  async updateShippingRate(id: string, patch: z.infer<typeof shippingRateUpdateSchema>, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(laneShippingRates).where(eq(laneShippingRates.id, id));
      if (!before) throw Errors.notFound('Shipping rate');
      const { price, ...rest } = patch;
      await tx
        .update(laneShippingRates)
        .set({ ...rest, ...(price ? { priceMinor: parseDecimalToMinor(price, 2) } : {}), updatedAt: new Date() })
        .where(eq(laneShippingRates.id, id));
      await this.audit.record(tx, meta, {
        action: 'shipping_rate.updated',
        entityType: 'shipping_rate',
        entityId: id,
        before: { serviceName: before.serviceName, maxWeightGrams: before.maxWeightGrams, priceMinor: before.priceMinor.toString(), isPlaceholder: before.isPlaceholder, active: before.active },
        after: patch,
      });
    });
    return this.listShippingRates();
  }

  async getFeeRule() {
    const [rule] = await this.db.select().from(feeRules).where(isNull(feeRules.laneId));
    return rule ? { percent: rule.percentBps / 100, defaultPayer: rule.defaultPayer, active: rule.active } : null;
  }

  async updateFeeRule(patch: z.infer<typeof feeRuleUpdateSchema>, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(feeRules).where(isNull(feeRules.laneId));
      if (!before) throw Errors.notFound('Fee rule');
      const bps = patch.percent !== undefined ? pct(patch.percent) : undefined;
      if (bps !== undefined && bps > 10000) throw Errors.badRequest('INVALID_PERCENT', 'The fee cannot be more than 100%');
      await tx
        .update(feeRules)
        .set({ ...(bps !== undefined ? { percentBps: bps } : {}), ...(patch.defaultPayer ? { defaultPayer: patch.defaultPayer } : {}), updatedAt: new Date() })
        .where(eq(feeRules.id, before.id));
      await this.audit.record(tx, meta, { action: 'fee_rule.updated', entityType: 'fee_rule', entityId: before.id, before: { percentBps: before.percentBps, defaultPayer: before.defaultPayer }, after: patch });
    });
    return this.getFeeRule();
  }

  async listDutyEstimates() {
    const rows = await this.db
      .select({ d: dutyEstimates, destination: countries.isoAlpha2 })
      .from(dutyEstimates)
      .innerJoin(countries, eq(countries.id, dutyEstimates.destinationCountryId))
      .orderBy(asc(countries.isoAlpha2), asc(dutyEstimates.hsPrefix));
    return rows.map(({ d, destination }) => ({
      id: d.id,
      destination,
      hsPrefix: d.hsPrefix,
      caricomOriginDutyPercent: d.caricomOriginDutyBps / 100,
      otherOriginDutyPercent: d.otherOriginDutyBps / 100,
      vatPercent: d.vatBps / 100,
      notes: d.notes,
      isPlaceholder: d.isPlaceholder,
    }));
  }

  async addDutyEstimate(input: z.infer<typeof dutyEstimateSchema>, meta: RequestMeta) {
    const [country] = await this.db.select().from(countries).where(eq(countries.isoAlpha2, input.destination));
    if (!country) throw Errors.notFound('Country');
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(dutyEstimates)
        .values({
          destinationCountryId: country.id,
          hsPrefix: input.hsPrefix,
          caricomOriginDutyBps: pct(input.caricomOriginDutyPercent),
          otherOriginDutyBps: pct(input.otherOriginDutyPercent),
          vatBps: pct(input.vatPercent),
          notes: input.notes,
          isPlaceholder: input.isPlaceholder,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) throw Errors.conflict('DUTY_ESTIMATE_EXISTS', 'An estimate for this country and HS prefix already exists');
      await this.audit.record(tx, meta, { action: 'duty_estimate.created', entityType: 'duty_estimate', entityId: row.id, after: input });
    });
    return this.listDutyEstimates();
  }

  async updateDutyEstimate(id: string, patch: z.infer<typeof dutyEstimateUpdateSchema>, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(dutyEstimates).where(eq(dutyEstimates.id, id));
      if (!before) throw Errors.notFound('Duty estimate');
      await tx
        .update(dutyEstimates)
        .set({
          ...(patch.caricomOriginDutyPercent !== undefined ? { caricomOriginDutyBps: pct(patch.caricomOriginDutyPercent) } : {}),
          ...(patch.otherOriginDutyPercent !== undefined ? { otherOriginDutyBps: pct(patch.otherOriginDutyPercent) } : {}),
          ...(patch.vatPercent !== undefined ? { vatBps: pct(patch.vatPercent) } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.isPlaceholder !== undefined ? { isPlaceholder: patch.isPlaceholder } : {}),
          updatedAt: new Date(),
        })
        .where(eq(dutyEstimates.id, id));
      await this.audit.record(tx, meta, {
        action: 'duty_estimate.updated',
        entityType: 'duty_estimate',
        entityId: id,
        before: { caricomOriginDutyBps: before.caricomOriginDutyBps, otherOriginDutyBps: before.otherOriginDutyBps, vatBps: before.vatBps, isPlaceholder: before.isPlaceholder },
        after: patch,
      });
    });
    return this.listDutyEstimates();
  }

  private async findLane(originIso: string, destinationIso: string) {
    const origin = aliasedTable(countries, 'origin');
    const destination = aliasedTable(countries, 'destination');
    const [row] = await this.db
      .select({ lane: lanes })
      .from(lanes)
      .innerJoin(origin, eq(origin.id, lanes.originCountryId))
      .innerJoin(destination, eq(destination.id, lanes.destinationCountryId))
      .where(and(eq(origin.isoAlpha2, originIso), eq(destination.isoAlpha2, destinationIso)));
    if (!row) throw Errors.badRequest('UNKNOWN_LANE', 'Create the trade lane first (Admin → Countries)');
    return row.lane;
  }
}
