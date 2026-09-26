import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, asc, eq, or } from 'drizzle-orm';
import type { CountryCreateInput, CountryUpdateInput } from '@iie/shared';
import { Database, DB } from '../db/db';
import { countries, currencies, lanes } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request';
import type { Principal } from '../rbac/principal';

type CountryRow = typeof countries.$inferSelect;
type CurrencyRow = typeof currencies.$inferSelect;

/**
 * Country settings convention: `settings.public` is shown on public pages; every other key is internal
 * configuration (tax notes, customs contacts, partner lists) visible only to administrators.
 */
function toPublic(country: CountryRow, currency: CurrencyRow) {
  const settings = country.settings ?? {};
  return {
    code: country.isoAlpha2,
    isoAlpha3: country.isoAlpha3,
    iieCode: country.iieCode,
    name: country.name,
    slug: country.slug,
    regionalBloc: country.regionalBloc,
    marketplaceEnabled: country.marketplaceEnabled,
    currency: { code: currency.code, name: currency.name, symbol: currency.symbol, minorUnit: currency.minorUnit },
    info: (settings.public as Record<string, unknown> | undefined) ?? {},
  };
}

@Injectable()
export class CountriesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** CARICOM countries; with `includeOrigins`, also the countries recorded only as a product's origin. */
  async list(includeOrigins = false) {
    const rows = await this.db
      .select({ country: countries, currency: currencies })
      .from(countries)
      .innerJoin(currencies, eq(currencies.code, countries.currencyCode))
      .where(includeOrigins ? undefined : eq(countries.regionalBloc, 'CARICOM'))
      .orderBy(asc(countries.name));
    return rows.map((r) => toPublic(r.country, r.currency));
  }

  /** Looks up by slug ("stlucia") or ISO alpha-2 ("LC"). */
  async get(key: string, includeInternal = false) {
    const [row] = await this.db
      .select({ country: countries, currency: currencies })
      .from(countries)
      .innerJoin(currencies, eq(currencies.code, countries.currencyCode))
      .where(or(eq(countries.slug, key.toLowerCase()), eq(countries.isoAlpha2, key.toUpperCase())));
    if (!row) throw Errors.notFound('Country');
    const lanesOut = await this.lanesFor(row.country.id);
    return {
      ...toPublic(row.country, row.currency),
      lanes: lanesOut,
      ...(includeInternal ? { id: row.country.id, settings: row.country.settings } : {}),
    };
  }

  listCurrencies() {
    return this.db.select().from(currencies).orderBy(asc(currencies.code));
  }

  async listLanes(onlyEnabled: boolean) {
    const origin = aliasedTable(countries, 'origin');
    const destination = aliasedTable(countries, 'destination');
    const rows = await this.db
      .select({ origin: origin.isoAlpha2, originName: origin.name, destination: destination.isoAlpha2, destinationName: destination.name, enabled: lanes.enabled })
      .from(lanes)
      .innerJoin(origin, eq(origin.id, lanes.originCountryId))
      .innerJoin(destination, eq(destination.id, lanes.destinationCountryId))
      .where(onlyEnabled ? eq(lanes.enabled, true) : undefined);
    return rows;
  }

  private async lanesFor(countryId: string) {
    const all = await this.listLanes(true);
    const [c] = await this.db.select({ iso: countries.isoAlpha2 }).from(countries).where(eq(countries.id, countryId));
    return all.filter((l) => l.origin === c!.iso || l.destination === c!.iso);
  }

  async create(principal: Principal, input: CountryCreateInput, meta: RequestMeta) {
    if (!principal.canGlobally('country.manage')) throw Errors.forbidden('Only platform administrators can add countries');
    await this.assertCurrency(input.currencyCode);
    return this.db.transaction(async (tx) => {
      const [created] = await tx.insert(countries).values(input).onConflictDoNothing().returning();
      if (!created) throw Errors.conflict('COUNTRY_EXISTS', 'A country with this code, IIE code or slug already exists');
      await this.audit.record(tx, meta, { action: 'country.created', entityType: 'country', entityId: created.id, after: created });
      return created;
    });
  }

  async update(principal: Principal, isoAlpha2: string, patch: CountryUpdateInput, meta: RequestMeta) {
    const [country] = await this.db.select().from(countries).where(eq(countries.isoAlpha2, isoAlpha2.toUpperCase()));
    if (!country) throw Errors.notFound('Country');
    if (!principal.canInCountry('country.manage', country.id)) throw Errors.forbidden();
    // Switching a country on or off, or changing identifiers used in transaction IDs, is platform-level.
    const platformLevel = ['marketplaceEnabled', 'iieCode', 'slug', 'currencyCode'] as const;
    if (platformLevel.some((k) => patch[k] !== undefined) && !principal.canGlobally('country.manage')) {
      throw Errors.forbidden('Only platform administrators can change these fields');
    }
    if (patch.currencyCode) await this.assertCurrency(patch.currencyCode);
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(countries)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(countries.id, country.id))
        .returning()
        .catch((err: { code?: string }) => {
          if (err.code === '23505') throw Errors.conflict('COUNTRY_EXISTS', 'Another country already uses this IIE code or slug');
          throw err;
        });
      const before = Object.fromEntries(Object.keys(patch).map((k) => [k, country[k as keyof CountryRow]]));
      await this.audit.record(tx, meta, { action: 'country.updated', entityType: 'country', entityId: country.id, before, after: patch });
      return updated;
    });
  }

  async setLane(principal: Principal, input: { origin: string; destination: string; enabled: boolean }, meta: RequestMeta) {
    if (!principal.canGlobally('country.manage')) throw Errors.forbidden('Only platform administrators can change trade lanes');
    if (input.origin === input.destination) throw Errors.badRequest('INVALID_LANE', 'Origin and destination must differ');
    const found = await this.db.select().from(countries).where(or(eq(countries.isoAlpha2, input.origin), eq(countries.isoAlpha2, input.destination)));
    const origin = found.find((c) => c.isoAlpha2 === input.origin);
    const destination = found.find((c) => c.isoAlpha2 === input.destination);
    if (!origin || !destination) throw Errors.notFound('Country');
    await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(lanes)
        .where(and(eq(lanes.originCountryId, origin.id), eq(lanes.destinationCountryId, destination.id)));
      await tx
        .insert(lanes)
        .values({ originCountryId: origin.id, destinationCountryId: destination.id, enabled: input.enabled })
        .onConflictDoUpdate({ target: [lanes.originCountryId, lanes.destinationCountryId], set: { enabled: input.enabled, updatedAt: new Date() } });
      await this.audit.record(tx, meta, {
        action: 'lane.updated',
        entityType: 'lane',
        entityId: `${input.origin}-${input.destination}`,
        before: existing ? { enabled: existing.enabled } : null,
        after: { enabled: input.enabled },
      });
    });
  }

  private async assertCurrency(code: string) {
    const [currency] = await this.db.select().from(currencies).where(eq(currencies.code, code));
    if (!currency) throw Errors.badRequest('UNKNOWN_CURRENCY', `Currency ${code} is not configured`);
  }
}
