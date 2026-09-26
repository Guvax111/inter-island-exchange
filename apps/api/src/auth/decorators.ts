import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@iie/shared';

export const IS_PUBLIC = 'iie:isPublic';
export const REQUIRED_PERMISSIONS = 'iie:permissions';
export const REQUIRE_ACTIVE = 'iie:requireActive';
export const AUTH_RATE_LIMIT = 'iie:authRateLimit';

/** No session required. A session, if present, is still resolved so handlers can personalise. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Caller must hold every listed permission (in at least one scope). Services check country scope. */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Caller's account must be ACTIVE (used for commercial actions from Phase 2). */
export const RequireActiveAccount = () => SetMetadata(REQUIRE_ACTIVE, true);

/** Applies the stricter per-IP limit used for sign-in, sign-up and password flows. */
export const AuthRateLimit = () => SetMetadata(AUTH_RATE_LIMIT, true);
