import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { Database, DB, Tx } from '../db/db';
import { sellerProfiles, supportMessages, supportThreads, transactions, users } from '../db/schema';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request';
import { AuditService } from '../audit/audit.service';
import { EVENTS } from '../email/notification.dispatcher';
import { NotificationsService } from '../notifications/notifications.service';
import { OutboxService } from '../outbox/outbox.service';
import type { Principal } from '../rbac/principal';

type ThreadRow = typeof supportThreads.$inferSelect;

/**
 * Conversations between a user and IIE. Buyers, sellers and partners never message each other directly: questions go
 * to IIE, which answers or passes the relevant part on. Messages cannot be edited or deleted (database triggers).
 */
@Injectable()
export class SupportService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ users

  async start(principal: Principal, input: { subject: string; body: string; iieId?: string }, meta: RequestMeta) {
    const transactionId = input.iieId ? await this.ownTransaction(principal, input.iieId) : null;
    const id = await this.db.transaction(async (tx) => {
      const [thread] = await tx.insert(supportThreads).values({ userId: principal.userId, subject: input.subject, transactionId }).returning();
      await tx.insert(supportMessages).values({ threadId: thread!.id, authorUserId: principal.userId, authorRole: 'USER', body: input.body });
      await this.audit.record(tx, meta, { action: 'support.thread_opened', entityType: 'support_thread', entityId: thread!.id, after: { subject: input.subject, iieId: input.iieId ?? null } });
      return thread!.id;
    });
    return this.viewOwn(principal, id);
  }

  async listOwn(principal: Principal) {
    const rows = await this.db.select().from(supportThreads).where(eq(supportThreads.userId, principal.userId)).orderBy(desc(supportThreads.lastMessageAt)).limit(100);
    return { items: await this.summaries(rows) };
  }

  async viewOwn(principal: Principal, id: string) {
    const thread = await this.load(id);
    if (thread.userId !== principal.userId) throw Errors.notFound('Conversation');
    return this.shape(thread, false);
  }

  /** The user writes again; a closed conversation reopens. */
  async replyOwn(principal: Principal, id: string, body: string, meta: RequestMeta) {
    const thread = await this.load(id);
    if (thread.userId !== principal.userId) throw Errors.notFound('Conversation');
    await this.db.transaction(async (tx) => {
      await tx.insert(supportMessages).values({ threadId: id, authorUserId: principal.userId, authorRole: 'USER', body });
      await tx.update(supportThreads).set({ status: 'OPEN', lastAuthorRole: 'USER', lastMessageAt: new Date() }).where(eq(supportThreads.id, id));
      await this.audit.record(tx, meta, { action: 'support.message', entityType: 'support_thread', entityId: id, after: { role: 'USER' } });
    });
    return this.viewOwn(principal, id);
  }

  // ------------------------------------------------------------------ IIE

  /** IIE's inbox, limited to users of the staff member's countries. `waiting`: the user spoke last. */
  async inbox(principal: Principal, filter: { status?: 'OPEN' | 'CLOSED'; waiting?: boolean }) {
    const scope = principal.scopeOf('support.respond');
    if (!scope) throw Errors.forbidden();
    const rows = await this.db
      .select({ thread: supportThreads })
      .from(supportThreads)
      .innerJoin(users, eq(users.id, supportThreads.userId))
      .where(
        and(
          filter.status ? eq(supportThreads.status, filter.status) : undefined,
          filter.waiting ? eq(supportThreads.lastAuthorRole, 'USER') : undefined,
          scope === 'ALL' ? undefined : inArray(users.countryId, [...scope]),
        ),
      )
      .orderBy(desc(supportThreads.lastMessageAt))
      .limit(200);
    return { items: await this.summaries(rows.map((r) => r.thread), true) };
  }

  async viewAsStaff(principal: Principal, id: string) {
    const thread = await this.loadForStaff(principal, id);
    return this.shape(thread, true);
  }

  async replyAsStaff(principal: Principal, id: string, body: string, meta: RequestMeta) {
    const thread = await this.loadForStaff(principal, id);
    await this.db.transaction(async (tx) => {
      await tx.insert(supportMessages).values({ threadId: id, authorUserId: principal.userId, authorRole: 'IIE', body });
      await tx.update(supportThreads).set({ status: 'OPEN', lastAuthorRole: 'IIE', lastMessageAt: new Date() }).where(eq(supportThreads.id, id));
      await this.audit.record(tx, meta, { action: 'support.message', entityType: 'support_thread', entityId: id, after: { role: 'IIE' } });
      await this.tellUser(tx, thread);
    });
    return this.viewAsStaff(principal, id);
  }

  async setStatus(principal: Principal, id: string, status: 'OPEN' | 'CLOSED', meta: RequestMeta) {
    const thread = await this.loadForStaff(principal, id);
    await this.db.transaction(async (tx) => {
      await tx.update(supportThreads).set({ status }).where(eq(supportThreads.id, id));
      await this.audit.record(tx, meta, { action: `support.${status === 'CLOSED' ? 'closed' : 'reopened'}`, entityType: 'support_thread', entityId: id, before: { status: thread.status }, after: { status } });
    });
    return this.viewAsStaff(principal, id);
  }

  // ------------------------------------------------------------------ helpers

  private async tellUser(tx: Tx, thread: ThreadRow) {
    const [user] = await tx.select().from(users).where(eq(users.id, thread.userId));
    const path = `/messages/${thread.id}`;
    await this.notifications.create(tx, thread.userId, { type: 'support.reply', title: 'IIE replied to your message', body: thread.subject, link: path, transactionId: thread.transactionId ?? undefined });
    await this.outbox.enqueue(tx, EVENTS.transactionUpdate, {
      email: user!.email,
      firstName: user!.firstName,
      iieId: '',
      subject: `IIE replied: ${thread.subject}`,
      message: 'IIE has replied to your message. Sign in to read it and reply.',
      path,
    });
  }

  /** An order the user bought or sold. */
  private async ownTransaction(principal: Principal, iieId: string): Promise<string> {
    const [row] = await this.db
      .select({ id: transactions.id })
      .from(transactions)
      .innerJoin(sellerProfiles, eq(sellerProfiles.id, transactions.sellerProfileId))
      .where(and(eq(transactions.iieId, iieId.trim().toUpperCase()), or(eq(transactions.buyerUserId, principal.userId), eq(sellerProfiles.userId, principal.userId))));
    if (!row) throw Errors.badRequest('ORDER_NOT_FOUND', 'That order number is not one of your orders');
    return row.id;
  }

  private async load(id: string): Promise<ThreadRow> {
    const [thread] = await this.db.select().from(supportThreads).where(eq(supportThreads.id, id));
    if (!thread) throw Errors.notFound('Conversation');
    return thread;
  }

  private async loadForStaff(principal: Principal, id: string): Promise<ThreadRow> {
    const thread = await this.load(id);
    const [user] = await this.db.select({ countryId: users.countryId }).from(users).where(eq(users.id, thread.userId));
    if (!principal.canInCountry('support.respond', user!.countryId)) throw Errors.notFound('Conversation');
    return thread;
  }

  private async summaries(rows: ThreadRow[], staff = false) {
    if (!rows.length) return [];
    const people = staff
      ? new Map(
          (await this.db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email }).from(users).where(inArray(users.id, [...new Set(rows.map((r) => r.userId))]))).map((u) => [u.id, u]),
        )
      : null;
    const orders = await this.iieIds(rows.map((r) => r.transactionId));
    return rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      status: r.status,
      iieId: r.transactionId ? (orders.get(r.transactionId) ?? null) : null,
      // For the user: IIE replied (unread-ish); for IIE: waiting on a reply.
      waitingFor: r.lastAuthorRole === 'USER' ? 'IIE' : 'USER',
      lastMessageAt: r.lastMessageAt,
      ...(people ? { user: people.get(r.userId) } : {}),
    }));
  }

  private async iieIds(ids: (string | null)[]) {
    const list = [...new Set(ids.filter((v): v is string => !!v))];
    if (!list.length) return new Map<string, string>();
    return new Map((await this.db.select({ id: transactions.id, iieId: transactions.iieId }).from(transactions).where(inArray(transactions.id, list))).map((t) => [t.id, t.iieId]));
  }

  private async shape(thread: ThreadRow, staff: boolean) {
    const rows = await this.db
      .select({ m: supportMessages, firstName: users.firstName })
      .from(supportMessages)
      .innerJoin(users, eq(users.id, supportMessages.authorUserId))
      .where(eq(supportMessages.threadId, thread.id))
      .orderBy(asc(supportMessages.id));
    const [summary] = await this.summaries([thread], staff);
    return {
      ...summary,
      createdAt: thread.createdAt,
      messages: rows.map((r) => ({
        role: r.m.authorRole,
        // Staff names stay private to IIE; users see "IIE".
        author: r.m.authorRole === 'IIE' && !staff ? 'IIE' : r.firstName,
        body: r.m.body,
        at: r.m.createdAt,
      })),
    };
  }
}
