import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Database, DB, Tx } from '../db/db';
import { auditLogs } from '../db/schema';
import type { RequestMeta } from '../common/request';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Call inside the same database transaction as the change being audited. */
  async record(tx: Tx, meta: Partial<RequestMeta>, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLogs).values({
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      actorUserId: meta.actorUserId ?? null,
      actorRoles: meta.actorRoles ?? [],
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      sessionId: meta.sessionId ?? null,
      requestId: meta.requestId ?? null,
    });
  }

  async list(filter: { entityType?: string; entityId?: string; actorUserId?: string; page: number; pageSize: number }) {
    const where = and(
      filter.entityType ? eq(auditLogs.entityType, filter.entityType) : undefined,
      filter.entityId ? eq(auditLogs.entityId, filter.entityId) : undefined,
      filter.actorUserId ? eq(auditLogs.actorUserId, filter.actorUserId) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.id))
        .limit(filter.pageSize)
        .offset((filter.page - 1) * filter.pageSize),
      this.db.select({ count: sql<number>`count(*)::int` }).from(auditLogs).where(where),
    ]);
    return { items: rows.map((r) => ({ ...r, id: r.id.toString() })), total: total?.count ?? 0, page: filter.page, pageSize: filter.pageSize };
  }
}
