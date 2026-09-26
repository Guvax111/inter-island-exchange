import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { outboxEvents } from '../src/db/schema';
import { OutboxService } from '../src/outbox/outbox.service';
import { EVENTS } from '../src/email/notification.dispatcher';
import { createTestApp, register, TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

describe('outbox', () => {
  it('removes one-time tokens from delivered events', async () => {
    const { email } = await register(ctx, { verify: false });
    const rows = await ctx.db.select().from(outboxEvents).where(sql`${outboxEvents.payload}->>'email' = ${email}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.processedAt).not.toBeNull();
    expect(rows[0]!.payload).not.toHaveProperty('token');
  });

  it('retries failed deliveries later instead of losing them', async () => {
    const outbox = ctx.app.get(OutboxService);
    await ctx.db.insert(outboxEvents).values({ type: EVENTS.passwordChanged, payload: { email: 'retry@example.com', firstName: 'R' } });
    const original = ctx.email.send.bind(ctx.email);
    ctx.email.send = async () => {
      throw new Error('SMTP unavailable');
    };
    try {
      await outbox.processBatch();
    } finally {
      ctx.email.send = original;
    }
    const [failed] = await ctx.db.select().from(outboxEvents).where(sql`${outboxEvents.payload}->>'email' = 'retry@example.com'`);
    expect(failed!.processedAt).toBeNull();
    expect(failed!.attempts).toBe(1);
    expect(failed!.lastError).toContain('SMTP unavailable');
    expect(failed!.availableAt.getTime()).toBeGreaterThan(Date.now());

    // Once due again, it is delivered.
    await ctx.db.update(outboxEvents).set({ availableAt: new Date(0) }).where(eq(outboxEvents.id, failed!.id));
    await ctx.flush();
    expect(ctx.email.sent.some((m) => m.to === 'retry@example.com')).toBe(true);
  });
});
