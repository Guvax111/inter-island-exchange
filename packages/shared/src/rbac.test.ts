import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_DEFINITIONS, ROLES, SELF_REGISTRABLE_ROLES } from './rbac';

describe('role catalogue', () => {
  it('defines every role with only known permissions', () => {
    for (const role of ROLES) {
      for (const p of ROLE_DEFINITIONS[role].permissions) expect(PERMISSIONS).toContain(p);
    }
  });
  it('never lets people self-register into operational roles', () => {
    for (const role of SELF_REGISTRABLE_ROLES) {
      const perms = ROLE_DEFINITIONS[role].permissions;
      expect(perms).not.toContain('user.roles.manage');
      expect(perms).not.toContain('user.read.any');
      expect(perms).not.toContain('country.manage');
    }
  });
});
