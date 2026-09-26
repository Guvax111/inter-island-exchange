import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { PERMISSIONS, ROLE_DEFINITIONS, ROLES } from '@iie/shared';
import { createDatabase, Database } from './db';
import { categories, countries, currencies, dutyEstimates, exchangeRates, feeRules, hsCodes, laneShippingRates, lanes, permissions, rolePermissions, roles } from './schema';
import { SEED_CATEGORIES, SEED_COUNTRIES, SEED_CURRENCIES, SEED_ORIGIN_COUNTRIES, SEED_DUTY_ESTIMATES, SEED_EXCHANGE_RATES, SEED_FEE_RULE, SEED_HS_CODES, SEED_LANES, SEED_SHIPPING_RATES } from './seed-data';

/** Makes the roles/permissions tables match the catalogue in @iie/shared. */
export async function syncRbac(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(permissions)
      .values(PERMISSIONS.map((key) => ({ key })))
      .onConflictDoNothing();
    for (const key of ROLES) {
      const def = ROLE_DEFINITIONS[key];
      await tx
        .insert(roles)
        .values({ key, name: def.name, description: def.description })
        .onConflictDoUpdate({ target: roles.key, set: { name: def.name, description: def.description } });
    }
    const roleRows = await tx.select().from(roles);
    const permRows = await tx.select().from(permissions);
    const permId = new Map(permRows.map((p) => [p.key, p.id]));
    for (const role of roleRows) {
      const def = ROLE_DEFINITIONS[role.key as keyof typeof ROLE_DEFINITIONS];
      if (!def) continue;
      const wanted = [...new Set(def.permissions)].map((p) => permId.get(p)!);
      await tx
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.roleId, role.id), notInArray(rolePermissions.permissionId, wanted)));
      await tx
        .insert(rolePermissions)
        .values(wanted.map((permissionId) => ({ roleId: role.id, permissionId })))
        .onConflictDoNothing();
    }
  });
}

export async function seedReferenceData(db: Database): Promise<void> {
  await db.insert(currencies).values(SEED_CURRENCIES).onConflictDoNothing();
  await db.insert(countries).values(SEED_COUNTRIES).onConflictDoNothing();
  await db.insert(countries).values(SEED_ORIGIN_COUNTRIES).onConflictDoNothing();
  const rows = await db
    .select({ id: countries.id, iso: countries.isoAlpha2 })
    .from(countries)
    .where(inArray(countries.isoAlpha2, SEED_LANES.flatMap((l) => [l.origin, l.destination])));
  const byIso = new Map(rows.map((r) => [r.iso, r.id]));
  for (const lane of SEED_LANES) {
    await db
      .insert(lanes)
      .values({ originCountryId: byIso.get(lane.origin)!, destinationCountryId: byIso.get(lane.destination)!, enabled: lane.enabled })
      .onConflictDoNothing();
  }
  await db.insert(hsCodes).values(SEED_HS_CODES).onConflictDoNothing();
  // Parents first, so children can reference them.
  for (const c of [...SEED_CATEGORIES].sort((a, b) => Number(!!a.parent) - Number(!!b.parent))) {
    const [parent] = c.parent ? await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, c.parent)) : [];
    await db
      .insert(categories)
      .values({ slug: c.slug, name: c.name, sortOrder: c.sortOrder, parentId: parent?.id ?? null })
      .onConflictDoNothing();
  }
  await seedCheckoutConfig(db);
  await syncRbac(db);
}

/** Checkout configuration is inserted only when none exists, so administrators' changes are never overwritten. */
async function seedCheckoutConfig(db: Database): Promise<void> {
  await db.insert(feeRules).values({ laneId: null, ...SEED_FEE_RULE }).onConflictDoNothing();
  const all = await db.select({ id: countries.id, iso: countries.isoAlpha2, currency: countries.currencyCode }).from(countries);
  const byIso = new Map(all.map((c) => [c.iso, c]));
  const laneKeys = [...new Set(SEED_SHIPPING_RATES.map((r) => `${r.origin}-${r.destination}`))];
  for (const key of laneKeys) {
    const [originIso, destinationIso] = key.split('-') as [string, string];
    const origin = byIso.get(originIso)!;
    const [lane] = await db
      .select()
      .from(lanes)
      .where(and(eq(lanes.originCountryId, origin.id), eq(lanes.destinationCountryId, byIso.get(destinationIso)!.id)));
    if (!lane) continue;
    const [existing] = await db.select({ id: laneShippingRates.id }).from(laneShippingRates).where(eq(laneShippingRates.laneId, lane.id)).limit(1);
    if (existing) continue;
    await db.insert(laneShippingRates).values(
      SEED_SHIPPING_RATES.filter((r) => `${r.origin}-${r.destination}` === key).map((r) => ({
        laneId: lane.id,
        serviceName: r.serviceName,
        maxWeightGrams: r.maxWeightGrams,
        priceMinor: r.priceMinor,
        currencyCode: origin.currency,
        isPlaceholder: true,
      })),
    );
  }
  const [anyRate] = await db.select({ id: exchangeRates.id }).from(exchangeRates).limit(1);
  if (!anyRate) await db.insert(exchangeRates).values(SEED_EXCHANGE_RATES);
  for (const d of SEED_DUTY_ESTIMATES) {
    const { destination, ...rest } = d;
    await db.insert(dutyEstimates).values({ destinationCountryId: byIso.get(destination)!.id, ...rest, isPlaceholder: true }).onConflictDoNothing();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const { db, pool } = createDatabase(url);
  seedReferenceData(db)
    .then(() => console.log('Seed complete'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
