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
