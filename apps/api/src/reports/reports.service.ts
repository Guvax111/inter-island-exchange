import { Inject, Injectable, Logger } from '@nestjs/common';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { Database, DB } from '../db/db';
import { currencies, reportRecipients, reportRuns } from '../db/schema';
import { Errors } from '../common/errors';
import { toMoneyDto } from '../common/money';
import type { RequestMeta } from '../common/request';
import { AuditService } from '../audit/audit.service';
import { EVENTS } from '../email/notification.dispatcher';
import { OutboxService } from '../outbox/outbox.service';
import type { Principal } from '../rbac/principal';
import { SettlementsService } from '../settlements/settlements.service';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** Reports run on St. Vincent time (UTC-4 all year, no daylight saving), where IIE's staging and team are. */
export const REPORT_UTC_OFFSET_HOURS = -4;
/** The scheduled report goes out on Monday at 08:00 local time, for the week that just ended. */
export const REPORT_SEND_HOUR = 8;

export type WeeklyFigures = Awaited<ReturnType<ReportsService['figures']>>;

/** Monday 00:00 local time (as a UTC instant) of the week containing `at`. */
export function weekStartOf(at: Date): Date {
  const local = new Date(at.getTime() + REPORT_UTC_OFFSET_HOURS * HOUR);
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  const mondayLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - sinceMonday * DAY;
  return new Date(mondayLocal - REPORT_UTC_OFFSET_HOURS * HOUR);
}

/**
 * The directors' weekly report: activity for one week (Monday to Sunday, St. Vincent time), money per currency, what
 * is waiting on IIE, and what is owed between IIE, the payment provider and logistics partners. Sent by email every
 * Monday morning to the recipients IIE lists; staff can preview it and send it on demand.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger('Reports');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settlements: SettlementsService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  /** Figures for the week starting at `from` (a Monday 00:00 local). */
  async figures(from: Date) {
    const to = new Date(from.getTime() + 7 * DAY);
    const one = async <T>(q: ReturnType<typeof sql>) => (await this.db.execute(q)).rows[0] as T;
    const many = async <T>(q: ReturnType<typeof sql>) => (await this.db.execute(q)).rows as T[];
    const currencyRows = await this.db.select().from(currencies);
    const cur = new Map(currencyRows.map((c) => [c.code, c]));
    const fmt = (code: string, minor: string | bigint | null) => toMoneyDto(BigInt(minor ?? 0), cur.get(code)!).formatted;

    // Status changes in the week, counted once per order.
    const reached = (status: string) => sql`select distinct transaction_id from transaction_events where to_status = ${status} and created_at >= ${from} and created_at < ${to}`;

    const orders = await one<Record<string, number>>(sql`
      select
        (select count(*) from transactions where created_at >= ${from} and created_at < ${to})::int as placed,
        (select count(*) from (${reached('PAYMENT_CONFIRMED')}) x)::int as paid,
        (select count(*) from (${reached('DELIVERED')}) x)::int as delivered,
        (select count(*) from (${reached('COMPLETED')}) x)::int as completed,
        (select count(*) from (${reached('CANCELLED')}) x)::int as cancelled,
        (select count(*) from (${reached('REFUNDED')}) x)::int as refunded,
        (select count(*) from transactions where status not in ('COMPLETED', 'CANCELLED', 'REFUNDED'))::int as "inProgress"`);

    const paidMoney = await many<{ currency: string; gmv: string; fees: string; orders: number }>(sql`
      select t.transaction_currency as currency, sum(t.total_minor)::text as gmv, sum(t.platform_fee_minor)::text as fees, count(*)::int as orders
      from transactions t where t.id in (${reached('PAYMENT_CONFIRMED')}) group by 1`);
    const refundMoney = await many<{ currency: string; total: string; count: number }>(sql`
      select currency_code as currency, sum(amount_minor)::text as total, count(*)::int as count
      from refunds where status = 'SUCCEEDED' and completed_at >= ${from} and completed_at < ${to} group by 1`);
    const payoutMoney = await many<{ currency: string; total: string; count: number }>(sql`
      select currency_code as currency, sum(amount_minor)::text as total, count(*)::int as count
      from payouts where status = 'PAID' and released_at >= ${from} and released_at < ${to} group by 1`);
    const codes = [...new Set([...paidMoney, ...refundMoney, ...payoutMoney].map((r) => r.currency))].sort();
    const money = codes.map((code) => {
      const p = paidMoney.find((r) => r.currency === code);
      const r = refundMoney.find((x) => x.currency === code);
      const o = payoutMoney.find((x) => x.currency === code);
      return {
        currency: code,
        paidOrders: p?.orders ?? 0,
        grossSales: fmt(code, p?.gmv ?? '0'),
        iieFees: fmt(code, p?.fees ?? '0'),
        refunds: fmt(code, r?.total ?? '0'),
        refundCount: r?.count ?? 0,
        sellerPayouts: fmt(code, o?.total ?? '0'),
        payoutCount: o?.count ?? 0,
      };
    });

    const disputes = await one<Record<string, number>>(sql`
      select
        (select count(*) from disputes where created_at >= ${from} and created_at < ${to})::int as opened,
        (select count(*) from disputes where decided_at >= ${from} and decided_at < ${to})::int as decided,
        (select count(*) from disputes where status = 'OPEN')::int as "openNow"`);

    const waiting = await one<Record<string, number>>(sql`
      select
        (select count(*) from seller_profiles where status = 'UNDER_REVIEW')::int as "sellersToReview",
        (select count(*) from products where status = 'PENDING_REVIEW')::int as "productsToReview",
        (select count(*) from reviews where status = 'PENDING')::int as "reviewsToModerate",
        (select count(*) from support_threads where status = 'OPEN' and last_author_role = 'USER')::int as "messagesAwaitingReply",
        (select count(*) from disputes where status = 'OPEN')::int as "openDisputes",
        (select count(*) from transactions where status in ('COMPLIANCE_HOLD', 'CUSTOMS_HOLD'))::int as "ordersOnHold"`);

    const growth = await one<Record<string, number>>(sql`
      select
        (select count(*) from users where created_at >= ${from} and created_at < ${to})::int as "newAccounts",
        (select count(*) from seller_profiles where status in ('APPROVED', 'ACTIVE') and reviewed_at >= ${from} and reviewed_at < ${to})::int as "sellersApproved",
        (select count(*) from products where published_at >= ${from} and published_at < ${to})::int as "productsPublished",
        (select count(*) from reviews where status = 'PUBLISHED' and moderated_at >= ${from} and moderated_at < ${to})::int as "reviewsPublished"`);

    const lanes = await many<{ origin: string; destination: string; currency: string; orders: number; gmv: string }>(sql`
      select o.iie_code as origin, d.iie_code as destination, t.transaction_currency as currency, count(*)::int as orders, sum(t.total_minor)::text as gmv
      from transactions t join countries o on o.id = t.origin_country_id join countries d on d.id = t.destination_country_id
      where t.id in (${reached('PAYMENT_CONFIRMED')}) group by 1, 2, 3 order by 4 desc, 1, 2`);

    const outlook = await this.settlements.outlook(14);
    const paid = await this.settlements.paidBetween(from, to);
    const settle = (kind: 'PROVIDER_REMITTANCE' | 'LOGISTICS_PAYMENT') => {
      const rows = outlook.filter((r) => r.kind === kind);
      const done = paid.filter((r) => r.kind === kind);
      return {
        overdue: rows.filter((r) => r.overdue !== '0').map((r) => fmt(r.currency, r.overdue)),
        dueNext14Days: rows.filter((r) => r.upcoming !== '0').map((r) => fmt(r.currency, r.upcoming)),
        settledThisWeek: done.map((r) => fmt(r.currency, r.total)),
      };
    };

    const localDate = (d: Date) =>
      new Date(d.getTime() + REPORT_UTC_OFFSET_HOURS * HOUR).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    return {
      period: { from: from.toISOString(), to: to.toISOString(), label: `${localDate(from)} to ${localDate(new Date(to.getTime() - 1))}` },
      orders,
      money,
      disputes,
      growth,
      waitingOnIie: waiting,
      lanes: lanes.map((l) => ({ lane: `${l.origin} → ${l.destination}`, orders: l.orders, grossSales: fmt(l.currency, l.gmv) })),
      settlements: { owedToIie: settle('PROVIDER_REMITTANCE'), owedByIie: settle('LOGISTICS_PAYMENT') },
      generatedAt: new Date().toISOString(),
    };
  }

  /** Preview for staff: the week that just ended, or the week starting on `weekOf` (any date in it). */
  preview(weekOf?: string) {
    return this.figures(this.reportWeek(weekOf));
  }

  /** Sends now (e.g. for a board meeting). Every recipient gets one email; each run is recorded. */
  async sendNow(principal: Principal, weekOf: string | undefined, meta: RequestMeta) {
    const from = this.reportWeek(weekOf);
    const sent = await this.send(from, 'MANUAL', principal.userId);
    if (sent === 0) throw Errors.badRequest('NO_RECIPIENTS', 'Add at least one active recipient first');
    await this.db.transaction((tx) => this.audit.record(tx, meta, { action: 'report.sent', entityType: 'report', entityId: from.toISOString(), after: { recipients: sent } }));
    return { recipients: sent, weekStart: from.toISOString() };
  }

  /**
   * Worker job: on Monday from 08:00 St. Vincent time, sends the report for the week that just ended. Runs at most
   * once per week (a unique index on scheduled runs), however many workers or ticks there are.
   */
  async sendWeeklyIfDue(now = new Date()): Promise<boolean> {
    const thisWeek = weekStartOf(now);
    if (now.getTime() < thisWeek.getTime() + REPORT_SEND_HOUR * HOUR) return false;
    const from = new Date(thisWeek.getTime() - 7 * DAY);
    const [done] = await this.db.select({ id: reportRuns.id }).from(reportRuns).where(sql`${reportRuns.kind} = 'SCHEDULED' and ${reportRuns.weekStart} = ${from}`);
    if (done) return false;
    const sent = await this.send(from, 'SCHEDULED', null);
    if (sent > 0) this.logger.log(`Weekly report for ${from.toISOString()} sent to ${sent} recipients`);
    return sent > 0;
  }

  private async send(from: Date, kind: 'SCHEDULED' | 'MANUAL', sentBy: string | null): Promise<number> {
    const figures = await this.figures(from);
    return this.db.transaction(async (tx) => {
      const recipients = await tx.select().from(reportRecipients).where(eq(reportRecipients.active, true));
      if (!recipients.length) return 0;
      const [run] = await tx
        .insert(reportRuns)
        .values({ kind, weekStart: from, recipients: recipients.length, figures, sentBy })
        .onConflictDoNothing()
        .returning();
      if (!run) return 0; // another worker sent this week's scheduled report
      for (const r of recipients) await this.outbox.enqueue(tx, EVENTS.weeklyReport, { email: r.email, firstName: r.name, figures });
      return recipients.length;
    });
  }

  private reportWeek(weekOf?: string): Date {
    if (!weekOf) return new Date(weekStartOf(new Date()).getTime() - 7 * DAY);
    const d = new Date(`${weekOf}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) throw Errors.badRequest('INVALID_DATE', 'Give a date as YYYY-MM-DD');
    return weekStartOf(d);
  }

  // ------------------------------------------------------------------ recipients and history

  async recipients() {
    return { items: await this.db.select().from(reportRecipients).orderBy(asc(reportRecipients.name)) };
  }

  async addRecipient(input: { email: string; name: string }, meta: RequestMeta) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(reportRecipients)
        .values({ email: input.email.toLowerCase(), name: input.name })
        .onConflictDoUpdate({ target: reportRecipients.email, set: { name: input.name, active: true } })
        .returning();
      await this.audit.record(tx, meta, { action: 'report.recipient_added', entityType: 'report_recipient', entityId: row!.id, after: { email: row!.email } });
      return row;
    });
  }

  async setRecipientActive(id: string, active: boolean, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.update(reportRecipients).set({ active }).where(eq(reportRecipients.id, id)).returning();
      if (!row) throw Errors.notFound('Recipient');
      await this.audit.record(tx, meta, { action: active ? 'report.recipient_enabled' : 'report.recipient_disabled', entityType: 'report_recipient', entityId: id, after: { email: row.email } });
    });
  }

  async runs() {
    const rows = await this.db.select().from(reportRuns).orderBy(desc(reportRuns.createdAt)).limit(52);
    return { items: rows.map((r) => ({ id: r.id, kind: r.kind, weekStart: r.weekStart, recipients: r.recipients, sentAt: r.createdAt, figures: r.figures })) };
  }
}
