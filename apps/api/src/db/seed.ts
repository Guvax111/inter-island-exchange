import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { PERMISSIONS, ROLE_DEFINITIONS, ROLES } from '@iie/shared';
import { createDatabase, Database } from './db';
import { countries, currencies, lanes, permissions, rolePermissions, roles } from './schema';
import { SEED_COUNTRIES, SEED_CURRENCIES, SEED_LANES } from './seed-data';

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
  await syncRbac(db);
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
