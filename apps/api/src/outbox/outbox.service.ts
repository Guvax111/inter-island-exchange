import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Database, DB, Tx } from '../db/db';
import { outboxEvents } from '../db/schema';
import { NotificationDispatcher } from '../email/notification.dispatcher';

export const MAX_OUTBOX_ATTEMPTS = 10;

@Injectable()
export class OutboxService {
  private readonly logger = new Logger('Outbox');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  /** Write inside the same transaction as the state change that produced the event. */
  async enqueue(tx: Tx, type: string, payload: Record<string, unknown>): Promise<void> {
    await tx.insert(outboxEvents).values({ type, payload });
  }

  /**
   * Claims and delivers a batch of due events. Safe to run in several workers at once
   * (FOR UPDATE SKIP LOCKED). Returns the number of events handled.
   */
  async processBatch(limit = 20): Promise<number> {
    return this.db.transaction(async (tx) => {
      const due = await tx.execute<{ id: string; type: string; payload: Record<string, unknown>; attempts: number }>(sql`
        select id, type, payload, attempts from ${outboxEvents}
        where processed_at is null and available_at <= now()
        order by id
        limit ${limit}
        for update skip locked`);
      for (const event of due.rows) {
        try {
          await this.dispatcher.dispatch(event.type, event.payload);
          // One-time tokens are only needed to build the email; do not keep them at rest once delivered.
          await tx.execute(sql`
            update ${outboxEvents}
            set processed_at = now(), attempts = attempts + 1, last_error = null, payload = payload - 'token'
            where id = ${event.id}`);
        } catch (err) {
          const attempts = event.attempts + 1;
          const message = err instanceof Error ? err.message : String(err);
          const dead = attempts >= MAX_OUTBOX_ATTEMPTS;
          this.logger.warn(`Event ${event.id} (${event.type}) failed attempt ${attempts}: ${message}`);
          const backoffSeconds = Math.min(3600, 2 ** attempts * 15);
          await tx.execute(sql`
            update ${outboxEvents}
            set attempts = ${attempts},
                last_error = ${(dead ? 'DEAD: ' : '') + message.slice(0, 1000)},
                available_at = now() + make_interval(secs => ${backoffSeconds}),
                processed_at = ${dead ? sql`now()` : sql`null`}
            where id = ${event.id}`);
        }
      }
      return due.rows.length;
    });
  }
}
