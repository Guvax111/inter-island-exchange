import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DELIVERY_CONFIRMATION_DAYS, formatMinor, REVIEW_PERIOD_DAYS, PAYMENT_WINDOW_MINUTES, SELLER_CONFIRMATION_HOURS, type TransactionStatus } from '@iie/shared';
import type { Tx } from '../db/db';
import { currencies, sellerProfiles, transactions, users } from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { OutboxService } from '../outbox/outbox.service';
import { EVENTS } from '../email/notification.dispatcher';

type TransactionRow = typeof transactions.$inferSelect;

/**
 * Turns transaction events into notifications for the buyer and seller (in-app, plus email via the outbox).
 * Emails go out for the moments that need attention; other steps are in-app only.
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
      case 'PREPARING_SHIPMENT':
        await toBuyer('order.packed', `${t.iieId} is packed`, 'The seller has packed your order and it is waiting for the logistics partner to collect it.');
        return;
      case 'PICKUP_SCHEDULED':
        await toBuyer('order.pickup_scheduled', `Pickup scheduled for ${t.iieId}`, 'The logistics partner has scheduled the collection from the seller.');
        return;
      case 'PICKED_UP':
        await toBuyer('order.shipped', `${t.iieId} has shipped`, 'The logistics partner has collected your order from the seller. Follow its progress on the order page.', true);
        return;
      case 'ARRIVED_DESTINATION':
        await toBuyer('order.arrived', `${t.iieId} has arrived in your country`, 'Your order has arrived and goes through customs next.');
        return;
      case 'CUSTOMS_HOLD':
        await toBuyer('order.customs_hold', `${t.iieId} is held by customs`, 'Customs is holding your parcel. The customs broker is dealing with it and we will keep you informed.', true);
        await toSeller('sale.customs_hold', `${t.iieId} is held by customs`, 'Customs in the destination country is holding the parcel. IIE may contact you for documents.');
        return;
      case 'CUSTOMS_CLEARED':
        await toBuyer('order.customs_cleared', `${t.iieId} cleared customs`, 'Your order has cleared customs. Any duties and taxes are paid on arrival, as shown on your order.');
        return;
      case 'OUT_FOR_DELIVERY':
        await toBuyer('order.out_for_delivery', `${t.iieId} is out for delivery`, 'Your order is on its way to you today. Have any duties and taxes ready to pay on arrival.', true);
        return;
      case 'DELIVERED':
        await toBuyer(
          'order.delivered',
          `${t.iieId} was delivered`,
          `Please confirm you received your order, or report a problem, within ${DELIVERY_CONFIRMATION_DAYS} days. If we do not hear from you, the delivery is confirmed automatically.`,
          true,
        );
        await toSeller('sale.delivered', `${t.iieId} was delivered`, 'The buyer received the order. Your payout follows after the review period.');
        return;
      case 'DELIVERY_CONFIRMED':
        await toBuyer('order.delivery_confirmed', `Delivery of ${t.iieId} confirmed`, 'Thank you. The delivery is confirmed.');
        await toSeller('sale.delivery_confirmed', `Delivery of ${t.iieId} confirmed`, `The delivery is confirmed. You are paid in ${REVIEW_PERIOD_DAYS} days if the buyer reports no problem.`, true);
        return;
      case 'DISPUTE_WINDOW':
        await toBuyer('order.review_period', `${REVIEW_PERIOD_DAYS} days to report a problem with ${t.iieId}`, `If something is wrong with your order, report it within ${REVIEW_PERIOD_DAYS} days. After that the seller is paid.`);
        return;
      case 'PARTIALLY_REFUNDED':
        await toBuyer('order.partially_refunded', `Part of your payment for ${t.iieId} is being refunded`, 'IIE decided on your report. See the order page for the amount and details.', true);
        await toSeller('sale.partially_refunded', `Partial refund on ${t.iieId}`, 'IIE decided on the buyer’s report. Your payout is reduced; see the order page.', true);
        return;
      case 'PAYOUT_APPROVED':
        await toSeller('sale.payout_approved', `Payout approved for ${t.iieId}`, 'Your payout has been approved and sent to the payment provider.');
        return;
      case 'COMPLETED':
        await toSeller('sale.paid_out', `You have been paid for ${t.iieId}`, 'The payment provider has released your payout. See Payouts in your dashboard.', true);
        await toBuyer('order.completed', `${t.iieId} is complete`, 'Thank you for shopping with IIE.');
        return;
      case 'DISPUTED':
        await toBuyer('order.problem_reported', `We received your report about ${t.iieId}`, 'IIE will look into it and contact you. Your payment stays held until it is resolved.', true);
        await toSeller('sale.problem_reported', `The buyer reported a problem with ${t.iieId}`, 'IIE will look into it and may contact you. The payout stays on hold until it is resolved.', true);
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
