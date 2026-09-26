import { Inject, Injectable, Logger } from '@nestjs/common';
import { aliasedTable, and, asc, desc, eq, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { TransactionStatus } from '@iie/shared';
import { Database, DB, Tx } from '../db/db';
import {
  countries,
  currencies,
  inventory,
  inventoryReservations,
  orderItems,
  orders,
  sellerProfiles,
  sellerStorefronts,
  transactionEvents,
  transactions,
  users,
} from '../db/schema';
import { Errors } from '../common/errors';
import { toMoneyDto } from '../common/money';
import type { RequestMeta } from '../common/request';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '../rbac/principal';
import { STATUS_LABELS } from './state-machine';
import { TransactionEngine } from './transaction-engine';
import { ShipmentsService } from '../logistics/shipments.service';

type TransactionRow = typeof transactions.$inferSelect;
type View = 'BUYER' | 'SELLER' | 'ADMIN';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger('Orders');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly engine: TransactionEngine,
    private readonly audit: AuditService,
    private readonly shipments: ShipmentsService,
  ) {}

  // ------------------------------------------------------------------ reads

  async listForBuyer(principal: Principal) {
    const rows = await this.summaryQuery().where(eq(transactions.buyerUserId, principal.userId)).orderBy(desc(transactions.createdAt));
    return rows.map((r) => this.summary(r));
  }

  async listForSeller(principal: Principal) {
    const [seller] = await this.db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, principal.userId));
    if (!seller) throw Errors.notFound('Seller profile');
    const rows = await this.summaryQuery().where(eq(transactions.sellerProfileId, seller.id)).orderBy(desc(transactions.createdAt));
    return rows.map((r) => this.summary(r));
  }

  /** Admin list, limited to transactions touching the admin's countries (origin or destination). */
  async listForAdmin(principal: Principal, q: { status?: string; q?: string; page: number; pageSize: number }) {
    const scope = principal.scopeOf('transaction.read.any');
    if (!scope) throw Errors.forbidden();
    const where = and(
      scope === 'ALL' ? undefined : or(inArray(transactions.originCountryId, [...scope]), inArray(transactions.destinationCountryId, [...scope])),
      q.status ? eq(transactions.status, q.status) : undefined,
      q.q ? ilike(transactions.iieId, `%${q.q.replace(/[\\%_]/g, '')}%`) : undefined,
    );
    const rows = await this.summaryQuery()
      .where(where)
      .orderBy(desc(transactions.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [total] = await this.db.select({ count: sql<number>`count(*)::int` }).from(transactions).where(where);
    return { items: rows.map((r) => this.summary(r)), total: total?.count ?? 0, page: q.page, pageSize: q.pageSize };
  }

  async getForBuyer(principal: Principal, iieId: string) {
    const t = await this.load(iieId);
    if (t.buyerUserId !== principal.userId) throw Errors.notFound('Order');
    return this.detail(t, 'BUYER');
  }

  async getForSeller(principal: Principal, iieId: string) {
    const t = await this.load(iieId);
    const [seller] = await this.db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, principal.userId));
    if (!seller || t.sellerProfileId !== seller.id) throw Errors.notFound('Order');
    return this.detail(t, 'SELLER');
  }

  async getForAdmin(principal: Principal, iieId: string) {
    const t = await this.load(iieId);
    if (!principal.canInCountry('transaction.read.any', t.originCountryId) && !principal.canInCountry('transaction.read.any', t.destinationCountryId)) {
      throw Errors.notFound('Transaction');
    }
    return this.detail(t, 'ADMIN');
  }

  // ------------------------------------------------------------------ changes

  async cancelByBuyer(principal: Principal, iieId: string, reason: string | undefined, meta: RequestMeta) {
    const t = await this.load(iieId);
    if (t.buyerUserId !== principal.userId) throw Errors.notFound('Order');
    await this.db.transaction(async (tx) => {
      await this.engine.transition(tx, t.id, 'CANCELLED', { type: 'BUYER', userId: principal.userId }, { reason: reason ?? 'Cancelled by the buyer', expectedVersion: t.version });
      await this.releaseReservations(tx, t.id);
      await this.audit.record(tx, meta, { action: 'order.cancelled', entityType: 'transaction', entityId: t.id, after: { iieId, reason: reason ?? null } });
    });
    return this.getForBuyer(principal, iieId);
  }

  /**
   * Cancels orders whose payment window has passed and releases their stock. Safe to run from several
   * workers (SKIP LOCKED). Returns the number cancelled.
   */
  async expireOverdue(now = new Date(), limit = 50): Promise<number> {
    return this.db.transaction(async (tx) => {
      const due = await tx
        .select({ id: transactions.id, iieId: transactions.iieId })
        .from(transactions)
        .where(and(inArray(transactions.status, ['AWAITING_PAYMENT', 'PAYMENT_FAILED']), lte(transactions.paymentDueAt, now)))
        .limit(limit)
        .for('update', { skipLocked: true });
      for (const t of due) {
        await this.engine.transition(tx, t.id, 'CANCELLED', { type: 'SYSTEM' }, { reason: 'Payment window expired' });
        await this.releaseReservations(tx, t.id);
        this.logger.log(`Expired unpaid order ${t.iieId}`);
      }
      return due.length;
    });
  }

  private async releaseReservations(tx: Tx, transactionId: string) {
    const open = await tx
      .select()
      .from(inventoryReservations)
      .where(and(eq(inventoryReservations.transactionId, transactionId), isNull(inventoryReservations.releasedAt), isNull(inventoryReservations.consumedAt)));
    for (const r of open) {
      await tx
        .update(inventory)
        .set({ quantityReserved: sql`greatest(${inventory.quantityReserved} - ${r.quantity}, 0)`, updatedAt: new Date() })
        .where(eq(inventory.variantId, r.variantId));
      await tx.update(inventoryReservations).set({ releasedAt: new Date() }).where(eq(inventoryReservations.id, r.id));
    }
  }

  // ------------------------------------------------------------------ shaping

  private async load(iieId: string): Promise<TransactionRow> {
    const [t] = await this.db.select().from(transactions).where(eq(transactions.iieId, iieId.toUpperCase()));
    if (!t) throw Errors.notFound('Order');
    return t;
  }

  private summaryQuery() {
    const origin = aliasedTable(countries, 'origin');
    const destination = aliasedTable(countries, 'destination');
    return this.db
      .select({ t: transactions, currency: currencies, storeName: sellerStorefronts.displayName, storeSlug: sellerStorefronts.slug, origin: origin.name, destination: destination.name, buyerFirstName: users.firstName })
      .from(transactions)
      .innerJoin(currencies, eq(currencies.code, transactions.transactionCurrency))
      .innerJoin(sellerStorefronts, eq(sellerStorefronts.sellerProfileId, transactions.sellerProfileId))
      .innerJoin(origin, eq(origin.id, transactions.originCountryId))
      .innerJoin(destination, eq(destination.id, transactions.destinationCountryId))
      .innerJoin(users, eq(users.id, transactions.buyerUserId))
      .$dynamic();
  }

  private summary(r: Awaited<ReturnType<OrdersService['summaryQuery']>>[number]) {
    return {
      iieId: r.t.iieId,
      status: r.t.status,
      statusLabel: STATUS_LABELS[r.t.status as TransactionStatus],
      total: toMoneyDto(r.t.totalMinor, r.currency),
      seller: { name: r.storeName, slug: r.storeSlug },
      buyerFirstName: r.buyerFirstName,
      route: `${r.origin} → ${r.destination}`,
      paymentDueAt: r.t.status === 'AWAITING_PAYMENT' ? r.t.paymentDueAt : null,
      createdAt: r.t.createdAt,
    };
  }

  private async detail(t: TransactionRow, view: View) {
    const [currency] = await this.db.select().from(currencies).where(eq(currencies.code, t.transactionCurrency));
    const [order] = await this.db.select().from(orders).where(eq(orders.id, t.orderId));
    const items = await this.db.select().from(orderItems).where(eq(orderItems.orderId, t.orderId)).orderBy(asc(orderItems.id));
    const events = await this.db.select().from(transactionEvents).where(eq(transactionEvents.transactionId, t.id)).orderBy(asc(transactionEvents.id));
    const [store] = await this.db.select().from(sellerStorefronts).where(eq(sellerStorefronts.sellerProfileId, t.sellerProfileId));
    const [buyer] = await this.db.select({ firstName: users.firstName, lastName: users.lastName, email: users.email }).from(users).where(eq(users.id, t.buyerUserId));
    const m = (v: bigint) => toMoneyDto(v, currency!);
    const address = order!.deliveryAddress as Record<string, string | null>;
    const buyerFee = t.feePayer === 'BUYER' ? t.platformFeeMinor : 0n;

    return {
      iieId: t.iieId,
      status: t.status,
      statusLabel: STATUS_LABELS[t.status as TransactionStatus],
      subStatuses: {
        payment: t.paymentStatus,
        shipment: t.shipmentStatus,
        customs: t.customsStatus,
        compliance: t.complianceStatus,
        dispute: t.disputeStatus,
        payout: t.payoutStatus,
      },
      paymentDueAt: ['AWAITING_PAYMENT', 'PAYMENT_FAILED'].includes(t.status) ? t.paymentDueAt : null,
      canCancel: view === 'BUYER' && ['AWAITING_PAYMENT', 'PAYMENT_FAILED'].includes(t.status),
      canPay: view === 'BUYER' && ['AWAITING_PAYMENT', 'PAYMENT_FAILED'].includes(t.status) && !!t.paymentDueAt && t.paymentDueAt > new Date(),
      sellerConfirmDueAt: t.status === 'AWAITING_SELLER_CONFIRMATION' ? t.sellerConfirmDueAt : null,
      canMarkReady: view === 'SELLER' && t.status === 'SELLER_CONFIRMED',
      canConfirmDelivery: view === 'BUYER' && t.status === 'DELIVERED',
      deliveryConfirmDueAt: t.status === 'DELIVERED' ? t.deliveryConfirmDueAt : null,
      seller: { name: store?.displayName, slug: store?.slug },
      buyer: view === 'SELLER' ? { firstName: buyer!.firstName } : buyer,
      // Sellers see where the order is going; the full address goes to the logistics partner only.
      deliveryAddress: view === 'SELLER' ? { city: address.city, country: address.country } : address,
      items: items.map((i) => ({
        sku: i.sku,
        title: i.title,
        variantName: i.variantName,
        quantity: i.quantity,
        unitPrice: m(i.unitPriceMinor),
        lineTotal: m(i.lineTotalMinor),
        hsCode: i.hsCode,
        countryOfOrigin: i.countryOfOrigin,
      })),
      amounts: {
        productCost: m(t.subtotalMinor),
        shipping: m(t.shippingMinor),
        platformFee: { ...m(t.platformFeeMinor), percent: t.platformFeeBps / 100, payer: t.feePayer, chargedToBuyer: m(buyerFee) },
        otherFees: m(t.otherFeesMinor),
        dutiesEstimate: { ...m(t.dutiesEstimateMinor), collected: t.dutiesCollected, paidWhen: 'ON_ARRIVAL' },
        total: m(t.totalMinor),
        ...(view !== 'BUYER' ? { sellerPayout: m(t.sellerPayoutMinor) } : {}),
      },
      currency: { transaction: t.transactionCurrency, buyer: t.buyerCurrency, payout: t.payoutCurrency, fxRate: t.fxRate, fxSource: t.fxSource },
      timeline: events.map((e) => ({
        status: e.toStatus,
        label: STATUS_LABELS[e.toStatus as TransactionStatus],
        at: e.createdAt,
        reason: e.reason,
        ...(view === 'ADMIN' ? { from: e.fromStatus, actorType: e.actorType, actorUserId: e.actorUserId, metadata: e.metadata } : {}),
      })),
      ...(await this.shipments.shipmentView(t, view)),
      createdAt: t.createdAt,
      ...(view === 'ADMIN' ? { version: t.version, id: t.id } : {}),
    };
  }
}
