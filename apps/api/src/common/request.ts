import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Principal } from '../rbac/principal';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      principal?: Principal;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
  sessionId: string | null;
  actorUserId: string | null;
  actorRoles: string[];
}

export function requestMeta(req: Request): RequestMeta {
  return {
    ip: req.ip ?? null,
    userAgent: req.header('user-agent')?.slice(0, 400) ?? null,
    requestId: req.requestId,
    sessionId: req.principal?.sessionId ?? null,
    actorUserId: req.principal?.userId ?? null,
    actorRoles: req.principal?.roles.map((r) => (r.countryId ? `${r.key}@${r.countryId}` : r.key)) ?? [],
  };
}
