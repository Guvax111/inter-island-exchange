import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { formatMinor, PAYMENT_WINDOW_MINUTES, type TransactionStatus } from '@iie/shared';
import type { Tx } from '../db/db';
import { currencies, sellerProfiles, transactions, users } from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { OutboxService } from '../outbox/outbox.service';
import { EVENTS } from '../email/notification.dispatcher';

type TransactionRow = typeof transactions.$inferSelect;

/**
 * Turns transaction events into notifications for the buyer and seller (in-app, plus email via the outbox).
 * Later phases add payment, shipping, customs, delivery, dispute and payout messages here.
 */
@Injectable()
export class TransactionNotifier {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService,
  ) {}

  async onTransition(tx: Tx, t: TransactionRow, from: TransactionStatus, to: TransactionStatus): Promise<void> {
    if (from === 'CREATED' && to === 'AWAITING_PAYMENT') return this.orderPlaced(tx, t);
    if (to === 'CANCELLED') return this.orderCancelled(tx, t, from);
  }

  private async parties(tx: Tx, t: TransactionRow) {
    const [buyer] = await tx.select({ email: users.email, firstName: users.firstName }).from(users).where(eq(users.id, t.buyerUserId));
    const [seller] = await tx
      .select({ userId: sellerProfiles.userId, legalName: sellerProfiles.legalName })
      .from(sellerProfiles)
      .where(eq(sellerProfiles.id, t.sellerProfileId));
    const [currency] = await tx.select().from(currencies).where(eq(currencies.code, t.transactionCurrency));
    const total = `${currency!.symbol}${formatMinor(t.totalMinor, currency!.minorUnit)}`;
    return { buyer: buyer!, seller: seller!, total };
  }

  private async orderPlaced(tx: Tx, t: TransactionRow) {
    const { buyer, seller, total } = await this.parties(tx, t);
    await this.notifications.create(tx, t.buyerUserId, {
      type: 'order.placed',
      title: `Order ${t.iieId} placed`,
      body: `Complete payment of ${total} within ${PAYMENT_WINDOW_MINUTES} minutes to keep your items reserved.`,
      link: `/orders/${t.iieId}`,
      transactionId: t.id,
    });
    await this.outbox.enqueue(tx, EVENTS.orderPlaced, { email: buyer.email, firstName: buyer.firstName, iieId: t.iieId, total });
    await this.notifications.create(tx, seller.userId, {
      type: 'sale.awaiting_payment',
      title: `New order ${t.iieId}`,
      body: `A buyer placed an order for ${total}. It is waiting for payment; do not ship until payment is confirmed.`,
      link: `/dashboard/seller/orders/${t.iieId}`,
      transactionId: t.id,
    });
  }

  private async orderCancelled(tx: Tx, t: TransactionRow, from: TransactionStatus) {
    const { buyer, seller } = await this.parties(tx, t);
    const expired = from === 'AWAITING_PAYMENT' && t.paymentDueAt && t.paymentDueAt <= new Date();
    const why = expired ? 'Payment was not received in time, so the reserved items were released.' : 'The order was cancelled and the reserved items were released.';
    await this.notifications.create(tx, t.buyerUserId, { type: 'order.cancelled', title: `Order ${t.iieId} cancelled`, body: why, link: `/orders/${t.iieId}`, transactionId: t.id });
    await this.outbox.enqueue(tx, EVENTS.orderCancelled, { email: buyer.email, firstName: buyer.firstName, iieId: t.iieId, reason: why });
    await this.notifications.create(tx, seller.userId, { type: 'sale.cancelled', title: `Order ${t.iieId} cancelled`, body: why, link: `/dashboard/seller/orders/${t.iieId}`, transactionId: t.id });
  }
}
