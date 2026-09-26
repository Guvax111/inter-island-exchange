import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { SIGN_IN_ALLOWED_STATUSES, type AccountStatus, type Permission } from '@iie/shared';
import { APP_CONFIG, AppConfig } from '../config/config';
import { Database, DB } from '../db/db';
import { users } from '../db/schema';
import { safeEqual } from '../common/crypto';
import { AppError, Errors } from '../common/errors';
import { Principal } from '../rbac/principal';
import { RbacService } from '../rbac/rbac.service';
import { IGNORE_SESSION, IS_PUBLIC, REQUIRE_ACTIVE, REQUIRED_PERMISSIONS } from './decorators';
import { SESSION_COOKIE, SessionService } from './session.service';
import { HttpStatus } from '@nestjs/common';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard, deny by default. Order of checks:
 *  1. Origin check on every state-changing request (public or not).
 *  2. Resolve session -> user -> principal.
 *  3. CSRF token check on state-changing requests made with a session.
 *  4. Account status, required permissions.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionService: SessionService,
    private readonly rbac: RbacService,
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) ?? false;
    const unsafe = !SAFE_METHODS.has(req.method);

    if (unsafe) {
      const origin = req.header('origin');
      if (origin && !this.config.allowedOrigins.includes(origin)) throw Errors.forbidden('Request origin not allowed');
    }

    if (this.reflector.getAllAndOverride<boolean>(IGNORE_SESSION, targets)) return true;

    const token: string | undefined = req.cookies?.[SESSION_COOKIE];
    const principal = token ? await this.buildPrincipal(token) : null;
    if (principal) req.principal = principal;

    if (!principal) {
      if (isPublic) return true;
      throw Errors.unauthenticated();
    }

    if (unsafe) {
      const header = req.header('x-csrf-token') ?? '';
      if (!safeEqual(header, principal.csrfToken)) {
        throw new AppError(HttpStatus.FORBIDDEN, 'CSRF_FAILED', 'Security check failed. Refresh the page and try again.');
      }
    }

    if (isPublic) return true;

    if (this.reflector.getAllAndOverride<boolean>(REQUIRE_ACTIVE, targets) && principal.status !== 'ACTIVE') {
      throw new AppError(HttpStatus.FORBIDDEN, 'ACCOUNT_NOT_ACTIVE', 'Finish verifying your account to do this');
    }
    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, targets) ?? [];
    for (const permission of required) {
      if (!principal.can(permission)) throw Errors.forbidden();
    }
    return true;
  }

  private async buildPrincipal(token: string): Promise<Principal | null> {
    const session = await this.sessionService.resolve(token);
    if (!session) return null;
    const [user] = await this.db
      .select({ id: users.id, status: users.status, countryId: users.countryId })
      .from(users)
      .where(eq(users.id, session.userId));
    if (!user || !SIGN_IN_ALLOWED_STATUSES.includes(user.status as AccountStatus)) {
      await this.sessionService.revoke(this.db, session.id);
      return null;
    }
    const { roles, grants } = await this.rbac.loadGrants(user.id);
    return new Principal(user.id, session.id, session.csrfToken, user.status as AccountStatus, user.countryId, roles, grants);
  }
}
