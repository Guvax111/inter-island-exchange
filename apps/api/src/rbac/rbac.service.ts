import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Permission } from '@iie/shared';
import { Database, DB, Tx } from '../db/db';
import { permissions, rolePermissions, roles, userRoles } from '../db/schema';
import type { Scope } from './principal';

@Injectable()
export class RbacService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async loadGrants(userId: string, tx: Tx = this.db) {
    const rows = await tx
      .select({ role: roles.key, countryId: userRoles.countryId, permission: permissions.key })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(userRoles.userId, userId));

    const grants = new Map<string, Scope>();
    const roleSet = new Map<string, { key: string; countryId: string | null }>();
    for (const row of rows) {
      roleSet.set(`${row.role}:${row.countryId ?? ''}`, { key: row.role, countryId: row.countryId });
      if (!row.permission) continue;
      const current = grants.get(row.permission);
      if (row.countryId === null || current === 'ALL') {
        grants.set(row.permission, 'ALL');
      } else {
        grants.set(row.permission, new Set([...(current ?? []), row.countryId]));
      }
    }
    return { roles: [...roleSet.values()], grants: grants as ReadonlyMap<Permission, Scope> };
  }

  async roleIdByKey(key: string, tx: Tx = this.db): Promise<string> {
    const [row] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, key));
    if (!row) throw new Error(`Role ${key} is not seeded`);
    return row.id;
  }
}
