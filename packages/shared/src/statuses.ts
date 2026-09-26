/**
 * Account lifecycle:
 *   DRAFT                 registered, onboarding not submitted
 *   PENDING_VERIFICATION  onboarding submitted, email not yet verified
 *   UNDER_REVIEW          held for manual review by compliance/admin
 *   ACTIVE                may use the platform
 *   SUSPENDED             blocked by an administrator (sessions revoked)
 *   REJECTED              application refused
 *   CLOSED                account closed
 */
export const ACCOUNT_STATUSES = ['DRAFT', 'PENDING_VERIFICATION', 'UNDER_REVIEW', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'CLOSED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Seller profile lifecycle. APPROVED -> ACTIVE happens when payout setup is complete (Phase 4). */
export const SELLER_STATUSES = ['DRAFT', 'PENDING_VERIFICATION', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'REJECTED'] as const;
export type SellerStatus = (typeof SELLER_STATUSES)[number];

export const BUYER_VERIFICATION_LEVELS = ['BASIC', 'VERIFIED', 'BUSINESS'] as const;
export type BuyerVerificationLevel = (typeof BUYER_VERIFICATION_LEVELS)[number];

export const ACCOUNT_TYPES = ['BUYER', 'SELLER', 'BUYER_SELLER'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const PARTY_TYPES = ['INDIVIDUAL', 'BUSINESS'] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

/** Account statuses that may sign in. */
export const SIGN_IN_ALLOWED_STATUSES: readonly AccountStatus[] = ['DRAFT', 'PENDING_VERIFICATION', 'UNDER_REVIEW', 'ACTIVE'];

/**
 * Product lifecycle:
 *   DRAFT -> PENDING_REVIEW -> ACTIVE (admin approval) | REJECTED
 *   ACTIVE <-> OUT_OF_STOCK (automatic, from inventory)
 *   SUSPENDED (admin), ARCHIVED (seller)
 */
export const PRODUCT_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'OUT_OF_STOCK', 'ARCHIVED'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Product statuses that can appear on the public marketplace (subject to the seller being active). */
export const PUBLIC_PRODUCT_STATUSES: readonly ProductStatus[] = ['ACTIVE', 'OUT_OF_STOCK'];

export const MAX_CART_QUANTITY = 99;

// ------------------------------------------------------------------ Phase 3: transactions

/** Every state in the central transaction lifecycle (see docs/IIE_TRANSACTION_STATE_MACHINE.md). */
export const TRANSACTION_STATUSES = [
  'CREATED',
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
  'PAYOUT_APPROVED',
  'PAYOUT_PROCESSING',
  'COMPLETED',
  // Exceptional states
  'CANCELLED',
  'PAYMENT_FAILED',
  'CUSTOMS_HOLD',
  'COMPLIANCE_HOLD',
  'DISPUTED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const TERMINAL_TRANSACTION_STATUSES: readonly TransactionStatus[] = ['COMPLETED', 'CANCELLED', 'REFUNDED'];

/** Who pays the IIE platform fee: added to the buyer's total, or deducted from the seller's payout. */
export const FEE_PAYERS = ['BUYER', 'SELLER'] as const;
export type FeePayer = (typeof FEE_PAYERS)[number];

/** Minutes a placed, unpaid order holds stock before it is cancelled. */
export const PAYMENT_WINDOW_MINUTES = 30;
/** Minutes a checkout quote stays valid. */
export const QUOTE_VALID_MINUTES = 15;

// ------------------------------------------------------------------ Phase 4: payments

/** Hours a seller has to confirm a paid order before it is refunded automatically. */
export const SELLER_CONFIRMATION_HOURS = 48;

export const PAYMENT_INTENT_STATUSES = ['REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
export type PaymentIntentStatus = (typeof PAYMENT_INTENT_STATUSES)[number];
