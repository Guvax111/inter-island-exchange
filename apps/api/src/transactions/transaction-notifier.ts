import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { formatMinor, PAYMENT_WINDOW_MINUTES, SELLER_CONFIRMATION_HOURS, type TransactionStatus } from '@iie/shared';
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
    const { buyer, seller, total } = await this.parties(tx, t);
    const buyerLink = `/orders/${t.iieId}`;
    const sellerLink = `/dashboard/seller/orders/${t.iieId}`;
    const toBuyer = (type: string, title: string, body: string, email = false) =>
      Promise.all([
        this.notifications.create(tx, t.buyerUserId, { type, title, body, link: buyerLink, transactionId: t.id }),
        email ? this.outbox.enqueue(tx, EVENTS.transactionUpdate, { email: buyer.email, firstName: buyer.firstName, iieId: t.iieId, subject: title, message: body, path: buyerLink }) : null,
      ]);
    const toSeller = async (type: string, title: string, body: string, email = false) => {
      await this.notifications.create(tx, seller.userId, { type, title, body, link: sellerLink, transactionId: t.id });
      if (email) {
        const [u] = await tx.select({ email: users.email, firstName: users.firstName }).from(users).where(eq(users.id, seller.userId));
        await this.outbox.enqueue(tx, EVENTS.transactionUpdate, { email: u!.email, firstName: u!.firstName, iieId: t.iieId, subject: title, message: body, path: sellerLink });
      }
    };
    switch (to) {
      case 'PAYMENT_FAILED':
        await toBuyer('order.payment_failed', `Payment for ${t.iieId} did not go through`, 'Your payment was declined. You can try again before the reservation ends.');
        return;
      case 'PAYMENT_PROCESSING':
        await toBuyer('order.payment_processing', `Payment for ${t.iieId} is processing`, 'We will let you know as soon as the payment partner confirms it.');
        return;
      case 'PAYMENT_CONFIRMED':
        await toBuyer('order.paid', `Payment received for ${t.iieId}`, `We received your payment of ${total}. The seller now confirms your order.`, true);
        return;
      case 'AWAITING_SELLER_CONFIRMATION':
        await toSeller('sale.paid', `Paid order ${t.iieId}: please confirm`, `The buyer has paid ${total}. Confirm the order within ${SELLER_CONFIRMATION_HOURS} hours or it will be refunded automatically.`, true);
        return;
      case 'SELLER_CONFIRMED':
        await toBuyer('order.seller_confirmed', `${seller.legalName} confirmed ${t.iieId}`, 'The seller is preparing your order. We will tell you when it ships.', true);
        return;
      case 'REFUNDED':
        await toBuyer('order.refunded', `Order ${t.iieId} refunded`, `Your payment of ${total} is being returned to you by the payment partner.`, true);
        await toSeller('sale.refunded', `Order ${t.iieId} refunded`, 'The buyer has been refunded. Nothing to ship.');
        return;
      case 'COMPLIANCE_HOLD':
        await toBuyer('order.on_hold', `Order ${t.iieId} is on hold`, 'IIE is reviewing this order. We will contact you if we need anything.');
        return;
      default:
        return;
    }
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
