import type { TransactionStatus } from '@iie/shared';

/** Who is asking for a transition. Each is checked against the table below. */
export type ActorType = 'BUYER' | 'SELLER' | 'ADMIN' | 'SYSTEM' | 'PAYMENT' | 'LOGISTICS' | 'CUSTOMS' | 'COMPLIANCE';

type Rules = Partial<Record<TransactionStatus, Partial<Record<TransactionStatus, readonly ActorType[]>>>>;

/**
 * Every allowed status change and who may make it. Anything not listed is refused.
 * Phase 3 uses CREATED -> AWAITING_PAYMENT -> CANCELLED. Later phases drive the rest through the same table.
 */
export const TRANSITIONS: Rules = {
  CREATED: { AWAITING_PAYMENT: ['SYSTEM'], CANCELLED: ['SYSTEM'] },
  AWAITING_PAYMENT: {
    PAYMENT_PROCESSING: ['PAYMENT'],
    PAYMENT_CONFIRMED: ['PAYMENT'],
    PAYMENT_FAILED: ['PAYMENT'],
    CANCELLED: ['BUYER', 'SYSTEM', 'ADMIN'],
  },
  PAYMENT_PROCESSING: { PAYMENT_CONFIRMED: ['PAYMENT'], PAYMENT_FAILED: ['PAYMENT'] },
  PAYMENT_FAILED: { AWAITING_PAYMENT: ['BUYER', 'SYSTEM'], CANCELLED: ['BUYER', 'SYSTEM', 'ADMIN'] },
  PAYMENT_CONFIRMED: { AWAITING_SELLER_CONFIRMATION: ['SYSTEM'] },
  // After payment, a cancellation is a refund, never a plain cancel.
  AWAITING_SELLER_CONFIRMATION: { SELLER_CONFIRMED: ['SELLER', 'ADMIN'], REFUNDED: ['SELLER', 'ADMIN', 'SYSTEM'] },
  SELLER_CONFIRMED: { PREPARING_SHIPMENT: ['SELLER', 'SYSTEM'] },
  PREPARING_SHIPMENT: { PICKUP_SCHEDULED: ['LOGISTICS', 'ADMIN'] },
  PICKUP_SCHEDULED: { PICKED_UP: ['LOGISTICS'] },
  PICKED_UP: { EXPORT_PROCESSING: ['LOGISTICS'] },
  EXPORT_PROCESSING: { IN_TRANSIT: ['LOGISTICS'] },
  IN_TRANSIT: { ARRIVED_DESTINATION: ['LOGISTICS'] },
  ARRIVED_DESTINATION: { CUSTOMS_PROCESSING: ['LOGISTICS', 'CUSTOMS'] },
  CUSTOMS_PROCESSING: { CUSTOMS_CLEARED: ['LOGISTICS', 'CUSTOMS'], CUSTOMS_HOLD: ['LOGISTICS', 'CUSTOMS', 'ADMIN'] },
  CUSTOMS_CLEARED: { OUT_FOR_DELIVERY: ['LOGISTICS'] },
  OUT_FOR_DELIVERY: { DELIVERED: ['LOGISTICS'] },
  DELIVERED: { DELIVERY_CONFIRMED: ['BUYER', 'SYSTEM'], DISPUTED: ['BUYER'] },
  DELIVERY_CONFIRMED: { DISPUTE_WINDOW: ['SYSTEM'] },
  DISPUTE_WINDOW: { PAYOUT_APPROVED: ['SYSTEM', 'ADMIN'], DISPUTED: ['BUYER'] },
  DISPUTED: { PAYOUT_APPROVED: ['ADMIN'], REFUNDED: ['ADMIN'], PARTIALLY_REFUNDED: ['ADMIN'] },
  PARTIALLY_REFUNDED: { PAYOUT_APPROVED: ['ADMIN', 'SYSTEM'] },
  CUSTOMS_HOLD: { REFUNDED: ['ADMIN'] },
  COMPLIANCE_HOLD: { REFUNDED: ['ADMIN'], CANCELLED: ['ADMIN'] },
  // A payment that arrives after the order was cancelled is refunded automatically.
  CANCELLED: { REFUNDED: ['SYSTEM'] },
  PAYOUT_APPROVED: { PAYOUT_PROCESSING: ['SYSTEM', 'PAYMENT'] },
  PAYOUT_PROCESSING: { COMPLETED: ['PAYMENT', 'SYSTEM'] },
};

/** Hold states remember where they interrupted the flow; leaving the hold returns there. */
export const HOLD_STATES: readonly TransactionStatus[] = ['CUSTOMS_HOLD', 'COMPLIANCE_HOLD', 'DISPUTED'];
const RELEASE_HOLD_ACTORS: Partial<Record<TransactionStatus, readonly ActorType[]>> = {
  CUSTOMS_HOLD: ['CUSTOMS', 'ADMIN'],
  COMPLIANCE_HOLD: ['COMPLIANCE', 'ADMIN'],
};

/** A compliance hold can interrupt any state from payment until payout is approved. */
const COMPLIANCE_HOLDABLE: readonly TransactionStatus[] = [
  'AWAITING_PAYMENT',
  'PAYMENT_PROCESSING',
  'PAYMENT_CONFIRMED',
  'AWAITING_SELLER_CONFIRMATION',
  'SELLER_CONFIRMED',
  'PREPARING_SHIPMENT',
  'PICKUP_SCHEDULED',
  'PICKED_UP',
  'EXPORT_PROCESSING',
  'IN_TRANSIT',
  'ARRIVED_DESTINATION',
  'CUSTOMS_PROCESSING',
  'CUSTOMS_CLEARED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_CONFIRMED',
  'DISPUTE_WINDOW',
];

export function allowedActors(from: TransactionStatus, to: TransactionStatus, heldFrom: TransactionStatus | null): readonly ActorType[] {
  const direct = TRANSITIONS[from]?.[to];
  if (direct) return direct;
  // SYSTEM places automatic holds (e.g. a payment amount that does not match the order).
  if (to === 'COMPLIANCE_HOLD' && COMPLIANCE_HOLDABLE.includes(from)) return ['COMPLIANCE', 'ADMIN', 'SYSTEM'];
  if (HOLD_STATES.includes(from) && heldFrom && to === heldFrom) return RELEASE_HOLD_ACTORS[from] ?? [];
  return [];
}

/** Sub-status columns updated automatically when a transaction enters a state. */
export const SUB_STATUS_ON_ENTER: Partial<Record<TransactionStatus, Record<string, string>>> = {
  AWAITING_PAYMENT: { paymentStatus: 'PENDING' },
  PAYMENT_PROCESSING: { paymentStatus: 'PROCESSING' },
  PAYMENT_CONFIRMED: { paymentStatus: 'PAID' },
  PAYMENT_FAILED: { paymentStatus: 'FAILED' },
  PICKUP_SCHEDULED: { shipmentStatus: 'PICKUP_SCHEDULED' },
  PICKED_UP: { shipmentStatus: 'PICKED_UP' },
  IN_TRANSIT: { shipmentStatus: 'IN_TRANSIT' },
  ARRIVED_DESTINATION: { shipmentStatus: 'ARRIVED' },
  CUSTOMS_PROCESSING: { customsStatus: 'PROCESSING' },
  CUSTOMS_HOLD: { customsStatus: 'HOLD' },
  CUSTOMS_CLEARED: { customsStatus: 'CLEARED' },
  OUT_FOR_DELIVERY: { shipmentStatus: 'OUT_FOR_DELIVERY' },
  DELIVERED: { shipmentStatus: 'DELIVERED' },
  COMPLIANCE_HOLD: { complianceStatus: 'ON_HOLD' },
  DISPUTED: { disputeStatus: 'OPEN' },
  PAYOUT_APPROVED: { payoutStatus: 'APPROVED' },
  PAYOUT_PROCESSING: { payoutStatus: 'PROCESSING' },
  COMPLETED: { payoutStatus: 'PAID' },
  REFUNDED: { paymentStatus: 'REFUNDED', payoutStatus: 'CANCELLED' },
  PARTIALLY_REFUNDED: { paymentStatus: 'PARTIALLY_REFUNDED' },
};

/** Plain-language description shown to buyers and sellers for each state. */
export const STATUS_LABELS: Record<TransactionStatus, string> = {
  CREATED: 'Order created',
  AWAITING_PAYMENT: 'Waiting for payment',
  PAYMENT_PROCESSING: 'Payment processing',
  PAYMENT_CONFIRMED: 'Payment confirmed',
  AWAITING_SELLER_CONFIRMATION: 'Waiting for the seller to confirm',
  SELLER_CONFIRMED: 'Seller confirmed',
  PREPARING_SHIPMENT: 'Preparing shipment',
  PICKUP_SCHEDULED: 'Pickup scheduled',
  PICKED_UP: 'Picked up',
  EXPORT_PROCESSING: 'Export processing',
  IN_TRANSIT: 'In transit',
  ARRIVED_DESTINATION: 'Arrived in destination country',
  CUSTOMS_PROCESSING: 'At customs',
  CUSTOMS_CLEARED: 'Cleared customs',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  DELIVERY_CONFIRMED: 'Delivery confirmed',
  DISPUTE_WINDOW: 'Review period',
  PAYOUT_APPROVED: 'Seller payout approved',
  PAYOUT_PROCESSING: 'Seller payout processing',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  PAYMENT_FAILED: 'Payment failed',
  CUSTOMS_HOLD: 'Held at customs',
  COMPLIANCE_HOLD: 'On hold for review',
  DISPUTED: 'Problem reported',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partially refunded',
};
