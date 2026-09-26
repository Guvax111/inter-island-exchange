import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { Errors } from '../common/errors';
import type { Principal } from '../rbac/principal';

/** The authenticated principal. Throws if absent (use only on non-public routes). */
export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  const principal = ctx.switchToHttp().getRequest<Request>().principal;
  if (!principal) throw Errors.unauthenticated();
  return principal;
});
