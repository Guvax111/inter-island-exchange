import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Database, DB, Tx } from '../db/db';
import { notifications } from '../db/schema';

export interface NewNotification {
  type: string;
  title: string;
  body: string;
  link?: string;
  transactionId?: string;
}

/** In-app notifications (the bell in the header). */
@Injectable()
export class NotificationsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async create(tx: Tx, userId: string, n: NewNotification): Promise<void> {
    await tx.insert(notifications).values({ userId, type: n.type, title: n.title, body: n.body, link: n.link ?? null, transactionId: n.transactionId ?? null });
  }

  async list(userId: string, limit = 30) {
    const [items, [unread]] = await Promise.all([
      this.db
        .select({ id: notifications.id, type: notifications.type, title: notifications.title, body: notifications.body, link: notifications.link, readAt: notifications.readAt, createdAt: notifications.createdAt })
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(limit),
      this.db.select({ count: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
    ]);
    return { items, unread: unread?.count ?? 0 };
  }

  /** Marks the given notifications (or all, when ids is empty) as read. Only the owner's rows are touched. */
  async markRead(userId: string, ids: string[]) {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), ids.length ? inArray(notifications.id, ids) : undefined));
  }
}
