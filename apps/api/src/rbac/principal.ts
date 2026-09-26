import type { AccountStatus, Permission } from '@iie/shared';

export type Scope = 'ALL' | ReadonlySet<string>;

/** The authenticated caller and everything they are allowed to do. Built fresh from the database per request. */
export class Principal {
  constructor(
    readonly userId: string,
    readonly sessionId: string,
    readonly csrfToken: string,
    readonly status: AccountStatus,
    readonly countryId: string,
    readonly roles: ReadonlyArray<{ key: string; countryId: string | null }>,
    private readonly grants: ReadonlyMap<string, Scope>,
  ) {}

  /** True if the permission is held in any scope. */
  can(permission: Permission): boolean {
    return this.grants.has(permission);
  }

  /** True if the permission is held globally. */
  canGlobally(permission: Permission): boolean {
    return this.grants.get(permission) === 'ALL';
  }

  canInCountry(permission: Permission, countryId: string): boolean {
    const scope = this.grants.get(permission);
    return scope === 'ALL' || (scope !== undefined && scope.has(countryId));
  }

  /** 'ALL', the set of country ids, or null when the permission is not held. */
  scopeOf(permission: Permission): Scope | null {
    return this.grants.get(permission) ?? null;
  }

  /** Permission keys held in any scope. For display only (e.g. hiding navigation); never for enforcement. */
  permissionKeys(): string[] {
    return [...this.grants.keys()];
  }

  hasRole(key: string): boolean {
    return this.roles.some((r) => r.key === key);
  }
}
