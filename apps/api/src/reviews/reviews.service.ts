import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { TransactionStatus } from '@iie/shared';
import { Database, DB } from '../db/db';
import { countries, orderItems, reviews, sellerProfiles, sellerStorefronts, transactions, users } from '../db/schema';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request';
import { AuditService } from '../audit/audit.service';
import { EVENTS } from '../email/notification.dispatcher';
import { NotificationsService } from '../notifications/notifications.service';
import { OutboxService } from '../outbox/outbox.service';
import type { Principal } from '../rbac/principal';

type ReviewRow = typeof reviews.$inferSelect;

/** A buyer can review once the delivery is confirmed and nothing is refunded in full or under dispute. */
export const REVIEWABLE: TransactionStatus[] = ['DISPUTE_WINDOW', 'PAYOUT_APPROVED', 'PAYOUT_PROCESSING', 'COMPLETED'];

/**
 * Ratings (1-5) with an optional written review, one per order. Nothing is published until IIE approves it: the
 * public sees only PUBLISHED reviews, and averages count only those.
 */
@Injectable()
export class ReviewsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ buyer

  async submit(principal: Principal, iieId: string, input: { rating: number; title?: string; body?: string }, meta: RequestMeta) {
    const [t] = await this.db.select().from(transactions).where(eq(transactions.iieId, iieId.toUpperCase()));
    if (!t || t.buyerUserId !== principal.userId) throw Errors.notFound('Order');
    if (!REVIEWABLE.includes(t.status as TransactionStatus)) {
      throw Errors.conflict('NOT_REVIEWABLE', 'You can review an order once you have confirmed its delivery');
    }
    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(reviews)
        .values({ transactionId: t.id, buyerUserId: principal.userId, sellerProfileId: t.sellerProfileId, rating: input.rating, title: input.title || null, body: input.body || null })
        .onConflictDoNothing()
        .returning();
      if (!row) throw Errors.conflict('ALREADY_REVIEWED', 'You have already reviewed this order');
      await this.audit.record(tx, meta, { action: 'review.submitted', entityType: 'review', entityId: row.id, after: { iieId: t.iieId, rating: input.rating } });
      return row.id;
    });
    return this.ownView((await this.db.select().from(reviews).where(eq(reviews.id, id)))[0]!);
  }

  /** The buyer's review of an order, for the order page. */
  async forOrder(transactionId: string) {
    const [row] = await this.db.select().from(reviews).where(eq(reviews.transactionId, transactionId));
    return row ? this.ownView(row) : null;
  }

  private ownView(r: ReviewRow) {
    return { rating: r.rating, title: r.title, body: r.body, status: r.status, moderationNote: r.status === 'REJECTED' ? r.moderationNote : null, submittedAt: r.createdAt };
  }

  // ------------------------------------------------------------------ IIE

  async queue(principal: Principal, status: 'PENDING' | 'PUBLISHED' | 'REJECTED') {
    const scope = principal.scopeOf('review.moderate');
    if (!scope) throw Errors.forbidden();
    const rows = await this.db
      .select({ r: reviews, iieId: transactions.iieId, store: sellerStorefronts.displayName, buyer: users.firstName, buyerLast: users.lastName })
      .from(reviews)
      .innerJoin(transactions, eq(transactions.id, reviews.transactionId))
      .innerJoin(sellerStorefronts, eq(sellerStorefronts.sellerProfileId, reviews.sellerProfileId))
      .innerJoin(users, eq(users.id, reviews.buyerUserId))
      .where(
        and(
          eq(reviews.status, status),
          scope === 'ALL' ? undefined : or(inArray(transactions.originCountryId, [...scope]), inArray(transactions.destinationCountryId, [...scope])),
        ),
      )
      .orderBy(status === 'PENDING' ? asc(reviews.createdAt) : desc(reviews.moderatedAt))
      .limit(200);
    return {
      items: rows.map((x) => ({
        id: x.r.id,
        iieId: x.iieId,
        seller: x.store,
        buyer: `${x.buyer} ${x.buyerLast}`,
        rating: x.r.rating,
        title: x.r.title,
        body: x.r.body,
        status: x.r.status,
        moderationNote: x.r.moderationNote,
        submittedAt: x.r.createdAt,
        moderatedAt: x.r.moderatedAt,
      })),
    };
  }

  async moderate(principal: Principal, id: string, input: { decision: 'PUBLISH' | 'REJECT'; note?: string }, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(reviews).where(eq(reviews.id, id)).for('update');
      if (!r) throw Errors.notFound('Review');
      const [t] = await tx.select().from(transactions).where(eq(transactions.id, r.transactionId));
      if (!principal.canInCountry('review.moderate', t!.originCountryId) && !principal.canInCountry('review.moderate', t!.destinationCountryId)) throw Errors.notFound('Review');
      if (r.status !== 'PENDING') throw Errors.conflict('ALREADY_MODERATED', 'This review has already been moderated');
      const status = input.decision === 'PUBLISH' ? 'PUBLISHED' : 'REJECTED';
      await tx.update(reviews).set({ status, moderationNote: input.note ?? null, moderatedBy: principal.userId, moderatedAt: new Date() }).where(eq(reviews.id, id));
      await this.audit.record(tx, meta, { action: `review.${status.toLowerCase()}`, entityType: 'review', entityId: id, before: { status: 'PENDING' }, after: { status, note: input.note ?? null } });

      const [buyer] = await tx.select().from(users).where(eq(users.id, r.buyerUserId));
      const path = `/orders/${t!.iieId}`;
      const title = status === 'PUBLISHED' ? 'Your review is published' : 'Your review was not published';
      const message = status === 'PUBLISHED' ? `Thank you: your review of ${t!.iieId} is now on the seller's page.` : `IIE did not publish your review of ${t!.iieId}: ${input.note}`;
      await this.notifications.create(tx, r.buyerUserId, { type: `review.${status.toLowerCase()}`, title, body: message, link: path, transactionId: t!.id });
      await this.outbox.enqueue(tx, EVENTS.transactionUpdate, { email: buyer!.email, firstName: buyer!.firstName, iieId: t!.iieId, subject: title, message, path });
      if (status === 'PUBLISHED') {
        const [seller] = await tx.select({ userId: sellerProfiles.userId }).from(sellerProfiles).where(eq(sellerProfiles.id, r.sellerProfileId));
        await this.notifications.create(tx, seller!.userId, { type: 'review.published', title: `New ${r.rating}-star review`, body: `A buyer reviewed ${t!.iieId}.`, link: `/dashboard/seller/orders/${t!.iieId}`, transactionId: t!.id });
      }
    });
  }

  // ------------------------------------------------------------------ public

  /** Average and count of published reviews for a seller. */
  async sellerRating(sellerProfileId: string) {
    const [row] = await this.db
      .select({ average: sql<string | null>`round(avg(${reviews.rating})::numeric, 1)::text`, count: sql<number>`count(*)::int` })
      .from(reviews)
      .where(and(eq(reviews.sellerProfileId, sellerProfileId), eq(reviews.status, 'PUBLISHED')));
    return row!.count ? { average: Number(row!.average), count: row!.count } : null;
  }

  async completedOrders(sellerProfileId: string) {
    const [row] = await this.db.select({ n: sql<number>`count(*)::int` }).from(transactions).where(and(eq(transactions.sellerProfileId, sellerProfileId), eq(transactions.status, 'COMPLETED')));
    return row!.n;
  }

  /** Published reviews of a seller, or of orders that included a product. */
  async published(filter: { sellerProfileId?: string; productId?: string }, limit = 20) {
    const productTx = filter.productId
      ? this.db.selectDistinct({ id: orderItems.orderId }).from(orderItems).where(eq(orderItems.productId, filter.productId))
      : null;
    const rows = await this.db
      .select({ r: reviews, firstName: users.firstName, lastName: users.lastName, country: countries.name })
      .from(reviews)
      .innerJoin(transactions, eq(transactions.id, reviews.transactionId))
      .innerJoin(users, eq(users.id, reviews.buyerUserId))
      .innerJoin(countries, eq(countries.id, transactions.destinationCountryId))
      .where(
        and(
          eq(reviews.status, 'PUBLISHED'),
          filter.sellerProfileId ? eq(reviews.sellerProfileId, filter.sellerProfileId) : undefined,
          productTx ? inArray(transactions.orderId, productTx) : undefined,
        ),
      )
      .orderBy(desc(reviews.moderatedAt))
      .limit(limit);
    return rows.map((x) => ({
      rating: x.r.rating,
      title: x.r.title,
      body: x.r.body,
      // First name and initial only.
      reviewer: `${x.firstName} ${x.lastName.slice(0, 1)}.`,
      reviewerCountry: x.country,
      at: x.r.createdAt,
    }));
  }

  async productRating(productId: string) {
    const [row] = await this.db
      .select({ average: sql<string | null>`round(avg(${reviews.rating})::numeric, 1)::text`, count: sql<number>`count(*)::int` })
      .from(reviews)
      .innerJoin(transactions, eq(transactions.id, reviews.transactionId))
      .where(and(eq(reviews.status, 'PUBLISHED'), inArray(transactions.orderId, this.db.selectDistinct({ id: orderItems.orderId }).from(orderItems).where(eq(orderItems.productId, productId)))));
    return row!.count ? { average: Number(row!.average), count: row!.count } : null;
  }
}
