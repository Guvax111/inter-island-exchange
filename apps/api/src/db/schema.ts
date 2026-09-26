import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`);

// ---------------------------------------------------------------- Country engine

export const currencies = pgTable('currencies', {
  code: char('code', { length: 3 }).primaryKey(),
  name: text('name').notNull(),
  symbol: varchar('symbol', { length: 8 }).notNull(),
  minorUnit: smallint('minor_unit').notNull(),
  createdAt: createdAt(),
});

export const countries = pgTable('countries', {
  id: id(),
  isoAlpha2: char('iso_alpha2', { length: 2 }).notNull().unique(),
  isoAlpha3: char('iso_alpha3', { length: 3 }).notNull().unique(),
  name: text('name').notNull(),
  /** Brand code used in transaction IDs, e.g. SLU in IIE-SLU-SVG-000001. */
  iieCode: varchar('iie_code', { length: 4 }).notNull().unique(),
  /** Public landing page path, e.g. "stlucia" for /stlucia. */
  slug: varchar('slug', { length: 50 }).notNull().unique(),
  currencyCode: char('currency_code', { length: 3 }).notNull().references(() => currencies.code),
  regionalBloc: varchar('regional_bloc', { length: 20 }).notNull().default('CARICOM'),
  marketplaceEnabled: boolean('marketplace_enabled').notNull().default(false),
  /** Country configuration not yet normalised into its own tables (tax notes, payment methods, ports...). */
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const lanes = pgTable(
  'lanes',
  {
    id: id(),
    originCountryId: uuid('origin_country_id').notNull().references(() => countries.id),
    destinationCountryId: uuid('destination_country_id').notNull().references(() => countries.id),
    enabled: boolean('enabled').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('lanes_origin_destination_uq').on(t.originCountryId, t.destinationCountryId),
    check('lanes_distinct_countries', sql`${t.originCountryId} <> ${t.destinationCountryId}`),
    index('lanes_destination_idx').on(t.destinationCountryId),
  ],
);

// ---------------------------------------------------------------- Identity

export const users = pgTable(
  'users',
  {
    id: id(),
    email: varchar('email', { length: 254 }).notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    firstName: varchar('first_name', { length: 100 }).notNull(),
    lastName: varchar('last_name', { length: 100 }).notNull(),
    countryId: uuid('country_id').notNull().references(() => countries.id),
    status: varchar('status', { length: 30 }).notNull().default('DRAFT'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    phone: varchar('phone', { length: 20 }),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    onboardingSubmittedAt: timestamp('onboarding_submitted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'users_status_chk',
      inList('status', ['DRAFT', 'PENDING_VERIFICATION', 'UNDER_REVIEW', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'CLOSED']),
    ),
    index('users_country_idx').on(t.countryId),
    index('users_status_idx').on(t.status),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    /** SHA-256 of the cookie token; the raw token is never stored. */
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    csrfToken: varchar('csrf_token', { length: 64 }).notNull(),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 400 }),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    purpose: varchar('purpose', { length: 30 }).notNull(),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check('verification_tokens_purpose_chk', inList('purpose', ['EMAIL_VERIFY', 'PASSWORD_RESET'])),
    index('verification_tokens_user_idx').on(t.userId, t.purpose),
  ],
);

export const mfaFactors = pgTable('mfa_factors', {
  id: id(),
  userId: uuid('user_id').notNull().unique().references(() => users.id),
  type: varchar('type', { length: 10 }).notNull().default('TOTP'),
  /** AES-256-GCM encrypted TOTP secret. */
  secretEncrypted: text('secret_encrypted').notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- RBAC

export const roles = pgTable('roles', {
  id: id(),
  key: varchar('key', { length: 50 }).notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  createdAt: createdAt(),
});

export const permissions = pgTable('permissions', {
  id: id(),
  key: varchar('key', { length: 80 }).notNull().unique(),
  createdAt: createdAt(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    roleId: uuid('role_id').notNull().references(() => roles.id),
    /** When set, the role's permissions apply only to this country. */
    countryId: uuid('country_id').references(() => countries.id),
    grantedBy: uuid('granted_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [unique('user_roles_uq').on(t.userId, t.roleId, t.countryId).nullsNotDistinct(), index('user_roles_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------- Profiles

export const addresses = pgTable(
  'addresses',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    label: varchar('label', { length: 50 }),
    line1: varchar('line1', { length: 200 }).notNull(),
    line2: varchar('line2', { length: 200 }),
    city: varchar('city', { length: 100 }).notNull(),
    region: varchar('region', { length: 100 }),
    postalCode: varchar('postal_code', { length: 20 }),
    countryId: uuid('country_id').notNull().references(() => countries.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('addresses_user_idx').on(t.userId)],
);

export const businesses = pgTable(
  'businesses',
  {
    id: id(),
    legalName: varchar('legal_name', { length: 200 }).notNull(),
    tradingName: varchar('trading_name', { length: 200 }),
    registrationNumber: varchar('registration_number', { length: 100 }),
    taxId: varchar('tax_id', { length: 100 }),
    countryId: uuid('country_id').notNull().references(() => countries.id),
    website: varchar('website', { length: 300 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('businesses_registration_uq').on(t.countryId, t.registrationNumber)],
);

export const buyerProfiles = pgTable(
  'buyer_profiles',
  {
    userId: uuid('user_id').primaryKey().references(() => users.id),
    partyType: varchar('party_type', { length: 20 }).notNull(),
    businessId: uuid('business_id').references(() => businesses.id),
    verificationLevel: varchar('verification_level', { length: 20 }).notNull().default('BASIC'),
    defaultAddressId: uuid('default_address_id').references(() => addresses.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('buyer_profiles_party_chk', inList('party_type', ['INDIVIDUAL', 'BUSINESS'])),
    check('buyer_profiles_level_chk', inList('verification_level', ['BASIC', 'VERIFIED', 'BUSINESS'])),
  ],
);

export const sellerProfiles = pgTable(
  'seller_profiles',
  {
    id: id(),
    userId: uuid('user_id').notNull().unique().references(() => users.id),
    partyType: varchar('party_type', { length: 20 }).notNull(),
    legalName: varchar('legal_name', { length: 200 }).notNull(),
    businessId: uuid('business_id').references(() => businesses.id),
    phone: varchar('phone', { length: 20 }).notNull(),
    website: varchar('website', { length: 300 }),
    category: varchar('category', { length: 100 }).notNull(),
    countryId: uuid('country_id').notNull().references(() => countries.id),
    addressId: uuid('address_id').notNull().references(() => addresses.id),
    status: varchar('status', { length: 30 }).notNull().default('DRAFT'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewNotes: text('review_notes'),
    /** Pilot: payouts are arranged manually until the payment partner integration (Phase 4). */
    payoutSetupConfirmedAt: timestamp('payout_setup_confirmed_at', { withTimezone: true }),
    payoutSetupConfirmedBy: uuid('payout_setup_confirmed_by').references(() => users.id),
    payoutSetupNote: text('payout_setup_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('seller_profiles_party_chk', inList('party_type', ['INDIVIDUAL', 'BUSINESS'])),
    check(
      'seller_profiles_status_chk',
      inList('status', ['DRAFT', 'PENDING_VERIFICATION', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'REJECTED']),
    ),
    index('seller_profiles_country_status_idx').on(t.countryId, t.status),
  ],
);

/** Transaction limits per country and buyer verification level. Enforced at checkout (Phase 3). */
export const verificationLimits = pgTable(
  'verification_limits',
  {
    id: id(),
    countryId: uuid('country_id').notNull().references(() => countries.id),
    level: varchar('level', { length: 20 }).notNull(),
    maxTransactionMinor: bigint('max_transaction_minor', { mode: 'bigint' }),
    currencyCode: char('currency_code', { length: 3 }).notNull().references(() => currencies.code),
    updatedAt: updatedAt(),
  },
  (t) => [unique('verification_limits_uq').on(t.countryId, t.level)],
);

export const accountDeletionRequests = pgTable(
  'account_deletion_requests',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    reason: text('reason'),
    status: varchar('status', { length: 20 }).notNull().default('REQUESTED'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processedBy: uuid('processed_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('account_deletion_status_chk', inList('status', ['REQUESTED', 'COMPLETED', 'CANCELLED'])),
    index('account_deletion_user_idx').on(t.userId),
  ],
);

// ---------------------------------------------------------------- Audit and events

/** Append-only (see migration 0001): UPDATE and DELETE raise an exception. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorRoles: text('actor_roles').array().notNull().default(sql`'{}'::text[]`),
    action: varchar('action', { length: 80 }).notNull(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: varchar('entity_id', { length: 100 }),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 400 }),
    sessionId: uuid('session_id'),
    requestId: varchar('request_id', { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entityType, t.entityId, t.createdAt),
    index('audit_logs_actor_idx').on(t.actorUserId, t.createdAt),
  ],
);

/** Transactional outbox: events are written with the change that caused them and delivered by the worker. */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    type: varchar('type', { length: 80 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [index('outbox_pending_idx').on(t.availableAt).where(sql`processed_at is null`)],
);

// ---------------------------------------------------------------- Phase 2: marketplace

/** Uploaded files. Stored through the StorageProvider; served by the API with visibility checks. */
export const mediaAssets = pgTable(
  'media_assets',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
    kind: varchar('kind', { length: 30 }).notNull(),
    storageKey: varchar('storage_key', { length: 200 }).notNull().unique(),
    contentType: varchar('content_type', { length: 50 }).notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: createdAt(),
  },
  (t) => [check('media_assets_kind_chk', inList('kind', ['PRODUCT_IMAGE', 'STORE_LOGO', 'DELIVERY_PHOTO', 'DELIVERY_SIGNATURE'])), index('media_assets_owner_idx').on(t.ownerUserId)],
);

export const sellerStorefronts = pgTable('seller_storefronts', {
  id: id(),
  sellerProfileId: uuid('seller_profile_id').notNull().unique().references(() => sellerProfiles.id),
  /** Public URL: /seller/{slug} */
  slug: varchar('slug', { length: 60 }).notNull().unique(),
  displayName: varchar('display_name', { length: 100 }).notNull(),
  description: text('description').notNull().default(''),
  logoMediaId: uuid('logo_media_id').references(() => mediaAssets.id),
  shippingOrigin: varchar('shipping_origin', { length: 100 }).notNull().default(''),
  returnPolicy: text('return_policy').notNull().default(''),
  storePolicies: text('store_policies').notNull().default(''),
  /** Seller's choice of who pays the IIE fee; null = platform default (fee_rules). */
  feePayer: varchar('fee_payer', { length: 10 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const categories = pgTable(
  'categories',
  {
    id: id(),
    parentId: uuid('parent_id'),
    name: varchar('name', { length: 80 }).notNull(),
    slug: varchar('slug', { length: 60 }).notNull().unique(),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('categories_parent_idx').on(t.parentId)],
);

/** Reference descriptions for Harmonized System codes. Products store the code itself; this table is informational. */
export const hsCodes = pgTable('hs_codes', {
  code: varchar('code', { length: 10 }).primaryKey(),
  description: text('description').notNull(),
});

export const products = pgTable(
  'products',
  {
    id: id(),
    sellerProfileId: uuid('seller_profile_id').notNull().references(() => sellerProfiles.id),
    title: varchar('title', { length: 150 }).notNull(),
    shortDescription: varchar('short_description', { length: 300 }).notNull(),
    description: text('description').notNull().default(''),
    categoryId: uuid('category_id').notNull().references(() => categories.id),
    brand: varchar('brand', { length: 100 }),
    hsCode: varchar('hs_code', { length: 10 }),
    countryOfOriginId: uuid('country_of_origin_id').notNull().references(() => countries.id),
    weightGrams: integer('weight_grams'),
    lengthMm: integer('length_mm'),
    widthMm: integer('width_mm'),
    heightMm: integer('height_mm'),
    attributes: jsonb('attributes').$type<Record<string, string>>().notNull().default({}),
    status: varchar('status', { length: 20 }).notNull().default('DRAFT'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewNotes: text('review_notes'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('products_status_chk', inList('status', ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'OUT_OF_STOCK', 'ARCHIVED'])),
    index('products_seller_status_idx').on(t.sellerProfileId, t.status),
    index('products_category_idx').on(t.categoryId),
    index('products_status_published_idx').on(t.status, t.publishedAt),
  ],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: id(),
    productId: uuid('product_id').notNull().references(() => products.id),
    /** Unique per seller (enforced in the service, and by sellerProfileId + sku). */
    sellerProfileId: uuid('seller_profile_id').notNull().references(() => sellerProfiles.id),
    sku: varchar('sku', { length: 64 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    priceMinor: bigint('price_minor', { mode: 'bigint' }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull().references(() => currencies.code),
    archived: boolean('archived').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('product_variants_seller_sku_uq').on(t.sellerProfileId, t.sku),
    check('product_variants_price_chk', sql`${t.priceMinor} > 0`),
    index('product_variants_product_idx').on(t.productId),
  ],
);

export const inventory = pgTable(
  'inventory',
  {
    variantId: uuid('variant_id').primaryKey().references(() => productVariants.id),
    quantityOnHand: integer('quantity_on_hand').notNull().default(0),
    /** Held for unpaid checkouts (Phase 3). */
    quantityReserved: integer('quantity_reserved').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('inventory_on_hand_chk', sql`${t.quantityOnHand} >= 0`),
    check('inventory_reserved_chk', sql`${t.quantityReserved} >= 0 and ${t.quantityReserved} <= ${t.quantityOnHand}`),
  ],
);

/** Append-only stock ledger: every change to on-hand quantity, with who and why. */
export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    variantId: uuid('variant_id').notNull().references(() => productVariants.id),
    delta: integer('delta').notNull(),
    quantityAfter: integer('quantity_after').notNull(),
    reason: varchar('reason', { length: 30 }).notNull(),
    note: varchar('note', { length: 200 }),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('inventory_movements_reason_chk', inList('reason', ['INITIAL', 'STOCK_COUNT', 'SALE', 'RETURN', 'CORRECTION'])),
    index('inventory_movements_variant_idx').on(t.variantId, t.createdAt),
  ],
);

export const productImages = pgTable(
  'product_images',
  {
    id: id(),
    productId: uuid('product_id').notNull().references(() => products.id),
    mediaId: uuid('media_id').notNull().unique().references(() => mediaAssets.id),
    altText: varchar('alt_text', { length: 200 }).notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('product_images_product_idx').on(t.productId, t.sortOrder)],
);

export const carts = pgTable('carts', {
  id: id(),
  userId: uuid('user_id').notNull().unique().references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Cart lines hold quantities only. Prices are always read live; they are frozen at checkout (Phase 3). */
export const cartItems = pgTable(
  'cart_items',
  {
    id: id(),
    cartId: uuid('cart_id').notNull().references(() => carts.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').notNull().references(() => productVariants.id),
    quantity: integer('quantity').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('cart_items_cart_variant_uq').on(t.cartId, t.variantId), check('cart_items_quantity_chk', sql`${t.quantity} between 1 and 99`)],
);

export const savedProducts = pgTable(
  'saved_products',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    productId: uuid('product_id').notNull().references(() => products.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.productId] })],
);

export const savedSellers = pgTable(
  'saved_sellers',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    sellerProfileId: uuid('seller_profile_id').notNull().references(() => sellerProfiles.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.sellerProfileId] })],
);

// ---------------------------------------------------------------- Phase 3: checkout and transactions

/** Shipping price bands per trade lane: the cheapest active band whose max weight covers the parcel applies. */
export const laneShippingRates = pgTable(
  'lane_shipping_rates',
  {
    id: id(),
    laneId: uuid('lane_id').notNull().references(() => lanes.id),
    serviceName: varchar('service_name', { length: 80 }).notNull(),
    maxWeightGrams: integer('max_weight_grams').notNull(),
    priceMinor: bigint('price_minor', { mode: 'bigint' }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull().references(() => currencies.code),
    /** True until the logistics partner's real rates are entered. Shown to administrators. */
    isPlaceholder: boolean('is_placeholder').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('lane_shipping_rates_price_chk', sql`${t.priceMinor} >= 0`),
    check('lane_shipping_rates_weight_chk', sql`${t.maxWeightGrams} > 0`),
    index('lane_shipping_rates_lane_idx').on(t.laneId, t.maxWeightGrams),
  ],
);

/** IIE platform fee. One global rule today (lane_id null); lane-specific rules can be added later. */
export const feeRules = pgTable(
  'fee_rules',
  {
    id: id(),
    laneId: uuid('lane_id').references(() => lanes.id),
    percentBps: integer('percent_bps').notNull(),
    defaultPayer: varchar('default_payer', { length: 10 }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('fee_rules_lane_uq').on(t.laneId).nullsNotDistinct(),
    check('fee_rules_bps_chk', sql`${t.percentBps} between 0 and 10000`),
    check('fee_rules_payer_chk', inList('default_payer', ['BUYER', 'SELLER'])),
  ],
);

/**
 * Duty and tax ESTIMATES by destination and HS prefix. Shown to buyers as estimates; actual charges are set
 * by customs on arrival. Duty = value x rate (CARICOM-origin goods usually differ); VAT applies to value + duty.
 */
export const dutyEstimates = pgTable(
  'duty_estimates',
  {
    id: id(),
    destinationCountryId: uuid('destination_country_id').notNull().references(() => countries.id),
    hsPrefix: varchar('hs_prefix', { length: 10 }).notNull().default(''),
    caricomOriginDutyBps: integer('caricom_origin_duty_bps').notNull(),
    otherOriginDutyBps: integer('other_origin_duty_bps').notNull(),
    vatBps: integer('vat_bps').notNull(),
    notes: text('notes').notNull().default(''),
    isPlaceholder: boolean('is_placeholder').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('duty_estimates_dest_prefix_uq').on(t.destinationCountryId, t.hsPrefix)],
);

/** A priced checkout for one seller, frozen for QUOTE_VALID_MINUTES. Orders are created only from quotes. */
export const quotes = pgTable(
  'quotes',
  {
    id: id(),
    buyerUserId: uuid('buyer_user_id').notNull().references(() => users.id),
    sellerProfileId: uuid('seller_profile_id').notNull().references(() => sellerProfiles.id),
    addressId: uuid('address_id').notNull().references(() => addresses.id),
    currencyCode: char('currency_code', { length: 3 }).notNull().references(() => currencies.code),
    /** Frozen lines and every amount; see CheckoutService.QuoteSnapshot. */
    snapshot: jsonb('snapshot').notNull(),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('quotes_buyer_idx').on(t.buyerUserId, t.createdAt)],
);

export const orders = pgTable('orders', {
  id: id(),
  buyerUserId: uuid('buyer_user_id').notNull().references(() => users.id),
  sellerProfileId: uuid('seller_profile_id').notNull().references(() => sellerProfiles.id),
  quoteId: uuid('quote_id').notNull().unique().references(() => quotes.id),
  /** Delivery address as it was when the order was placed. */
  deliveryAddress: jsonb('delivery_address').notNull(),
  createdAt: createdAt(),
});

/** Price and product snapshot per line. Never read product tables to price an existing order. */
export const orderItems = pgTable(
  'order_items',
  {
    id: id(),
    orderId: uuid('order_id').notNull().references(() => orders.id),
    variantId: uuid('variant_id').notNull().references(() => productVariants.id),
    productId: uuid('product_id').notNull().references(() => products.id),
    sku: varchar('sku', { length: 64 }).notNull(),
    title: varchar('title', { length: 150 }).notNull(),
    variantName: varchar('variant_name', { length: 100 }).notNull(),
    hsCode: varchar('hs_code', { length: 10 }),
    countryOfOrigin: char('country_of_origin', { length: 2 }).notNull(),
    unitWeightGrams: integer('unit_weight_grams').notNull(),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'bigint' }).notNull(),
    quantity: integer('quantity').notNull(),
    lineTotalMinor: bigint('line_total_minor', { mode: 'bigint' }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull().references(() => currencies.code),
  },
  (t) => [index('order_items_order_idx').on(t.orderId), check('order_items_quantity_chk', sql`${t.quantity} > 0`)],
);

/**
 * The central transaction record: one per order, one IIE ID, every sub-status and every amount (minor units,
 * frozen at order time). Status changes only through TransactionEngine.transition().
 */
export const transactions = pgTable(
  'transactions',
  {
    id: id(),
    iieId: varchar('iie_id', { length: 40 }).notNull().unique(),
    orderId: uuid('order_id').notNull().unique().references(() => orders.id),
    buyerUserId: uuid('buyer_user_id').notNull().references(() => users.id),
    sellerProfileId: uuid('seller_profile_id').notNull().references(() => sellerProfiles.id),
    originCountryId: uuid('origin_country_id').notNull().references(() => countries.id),
    destinationCountryId: uuid('destination_country_id').notNull().references(() => countries.id),
    status: varchar('status', { length: 40 }).notNull(),
    /** Incremented on every transition; guards against lost updates. */
    version: integer('version').notNull().default(0),
    /** State interrupted by a hold (CUSTOMS_HOLD, COMPLIANCE_HOLD, DISPUTED), to return to afterwards. */
    heldFromStatus: varchar('held_from_status', { length: 40 }),
    paymentStatus: varchar('payment_status', { length: 30 }).notNull().default('NOT_STARTED'),
    shipmentStatus: varchar('shipment_status', { length: 30 }).notNull().default('NOT_STARTED'),
    customsStatus: varchar('customs_status', { length: 30 }).notNull().default('NOT_STARTED'),
    complianceStatus: varchar('compliance_status', { length: 30 }).notNull().default('NOT_CHECKED'),
    disputeStatus: varchar('dispute_status', { length: 30 }).notNull().default('NONE'),
    payoutStatus: varchar('payout_status', { length: 30 }).notNull().default('NOT_STARTED'),
    // Currency: the pilot lane is XCD -> XCD, so the exchange rate is 1. Rates are stored so they are never recomputed.
    transactionCurrency: char('transaction_currency', { length: 3 }).notNull().references(() => currencies.code),
    buyerCurrency: char('buyer_currency', { length: 3 }).notNull().references(() => currencies.code),
    payoutCurrency: char('payout_currency', { length: 3 }).notNull().references(() => currencies.code),
    fxRate: numeric('fx_rate', { precision: 18, scale: 8 }).notNull().default('1'),
    fxSource: varchar('fx_source', { length: 40 }).notNull().default('SAME_CURRENCY'),
    fxRecordedAt: timestamp('fx_recorded_at', { withTimezone: true }).notNull().defaultNow(),
    subtotalMinor: bigint('subtotal_minor', { mode: 'bigint' }).notNull(),
    shippingMinor: bigint('shipping_minor', { mode: 'bigint' }).notNull(),
    platformFeeMinor: bigint('platform_fee_minor', { mode: 'bigint' }).notNull(),
    platformFeeBps: integer('platform_fee_bps').notNull(),
    feePayer: varchar('fee_payer', { length: 10 }).notNull(),
    otherFeesMinor: bigint('other_fees_minor', { mode: 'bigint' }).notNull().default(sql`0`),
    /** Estimated duties and taxes (not collected by IIE; payable on arrival). */
    dutiesEstimateMinor: bigint('duties_estimate_minor', { mode: 'bigint' }).notNull(),
    dutiesCollected: boolean('duties_collected').notNull().default(false),
    /** What the buyer pays IIE's payment partner. */
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    /** What the seller will receive once the transaction completes. */
    sellerPayoutMinor: bigint('seller_payout_minor', { mode: 'bigint' }).notNull(),
    paymentDueAt: timestamp('payment_due_at', { withTimezone: true }),
    /** Deadline for the seller to confirm a paid order; after it the order is refunded automatically. */
    sellerConfirmDueAt: timestamp('seller_confirm_due_at', { withTimezone: true }),
    /** After delivery: when the order is confirmed automatically if the buyer has not confirmed or reported a problem. */
    deliveryConfirmDueAt: timestamp('delivery_confirm_due_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('transactions_fee_payer_chk', inList('fee_payer', ['BUYER', 'SELLER'])),
    index('transactions_status_idx').on(t.status),
    index('transactions_buyer_idx').on(t.buyerUserId, t.createdAt),
    index('transactions_seller_idx').on(t.sellerProfileId, t.createdAt),
    index('transactions_payment_due_idx').on(t.paymentDueAt).where(sql`status = 'AWAITING_PAYMENT'`),
    index('transactions_seller_due_idx').on(t.sellerConfirmDueAt).where(sql`status = 'AWAITING_SELLER_CONFIRMATION'`),
    index('transactions_delivery_due_idx').on(t.deliveryConfirmDueAt).where(sql`status = 'DELIVERED'`),
  ],
);

/** Append-only log of every state change (trigger in migration 0005). */
export const transactionEvents = pgTable(
  'transaction_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    transactionId: uuid('transaction_id').notNull().references(() => transactions.id),
    fromStatus: varchar('from_status', { length: 40 }),
    toStatus: varchar('to_status', { length: 40 }).notNull(),
    actorType: varchar('actor_type', { length: 20 }).notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    reason: text('reason'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('transaction_events_tx_idx').on(t.transactionId, t.id)],
);

/** Stock held for an unpaid order. Released on cancellation or expiry; consumed when payment is confirmed (Phase 4). */
export const inventoryReservations = pgTable(
  'inventory_reservations',
  {
    id: id(),
    transactionId: uuid('transaction_id').notNull().references(() => transactions.id),
    variantId: uuid('variant_id').notNull().references(() => productVariants.id),
    quantity: integer('quantity').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('inventory_reservations_tx_idx').on(t.transactionId), check('inventory_reservations_qty_chk', sql`${t.quantity} > 0`)],
);

/** In-app notifications (the bell). Email copies go through the outbox. */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    type: varchar('type', { length: 60 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    body: text('body').notNull(),
    link: varchar('link', { length: 300 }),
    transactionId: uuid('transaction_id').references(() => transactions.id),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

// ---------------------------------------------------------------- Phase 4: payments, refunds, payouts, ledger, FX

/**
 * One attempt to collect a transaction's total through a payment provider. Card data never reaches IIE:
 * the buyer pays on the provider's hosted page and the provider reports back by signed webhook.
 */
export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: id(),
    transactionId: uuid('transaction_id').notNull().references(() => transactions.id),
    provider: varchar('provider', { length: 40 }).notNull(),
    providerIntentId: varchar('provider_intent_id', { length: 120 }).notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull().references(() => currencies.code),
    status: varchar('status', { length: 20 }).notNull().default('REQUIRES_ACTION'),
    redirectUrl: text('redirect_url').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('payment_intents_provider_uq').on(t.provider, t.providerIntentId),
    check('payment_intents_status_chk', inList('status', ['REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED'])),
    index('payment_intents_tx_idx').on(t.transactionId),
  ],
);

/** Append-only history of what the provider reported for each intent. */
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    paymentIntentId: uuid('payment_intent_id').notNull().references(() => paymentIntents.id),
    type: varchar('type', { length: 60 }).notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }),
    currencyCode: char('currency_code', { length: 3 }),
    webhookId: uuid('webhook_id'),
    detail: jsonb('detail').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('payment_events_intent_idx').on(t.paymentIntentId, t.id)],
);

/** Every webhook exactly as received, stored before processing. Unique per provider event: duplicates are ignored. */
export const providerWebhooks = pgTable(
  'provider_webhooks',
  {
    id: id(),
    provider: varchar('provider', { length: 40 }).notNull(),
    eventId: varchar('event_id', { length: 120 }).notNull(),
    eventType: varchar('event_type', { length: 60 }).notNull(),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    result: varchar('result', { length: 40 }),
    error: text('error'),
  },
  (t) => [unique('provider_webhooks_event_uq').on(t.provider, t.eventId)],
);

export const refunds = pgTable(
  'refunds',
  {
    id: id(),
    transactionId: uuid('transaction_id').notNull().references(() => transactions.id),
    paymentIntentId: uuid('payment_intent_id').notNull().references(() => paymentIntents.id),
    provider: varchar('provider', { length: 40 }).notNull(),
    providerRefundId: varchar('provider_refund_id', { length: 120 }),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull().references(() => currencies.code),
    reason: text('reason').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    requestedBy: varchar('requested_by', { length: 20 }).notNull(),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    check('refunds_status_chk', inList('status', ['PENDING', 'SUCCEEDED', 'FAILED'])),
    check('refunds_amount_chk', sql`${t.amountMinor} > 0`),
    index('refunds_tx_idx').on(t.transactionId),
  ],
);

/**
 * What IIE owes each seller per transaction. Created when payment is confirmed (ON_HOLD); released after delivery
 * and the review period (Phases 5-6) through the payment partner, or recorded manually during the pilot.
 */
export const payouts = pgTable(
  'payouts',
  {
    id: id(),
    transactionId: uuid('transaction_id').notNull().unique().references(() => transactions.id),
    sellerProfileId: uuid('seller_profile_id').notNull().references(() => sellerProfiles.id),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull().references(() => currencies.code),
    status: varchar('status', { length: 20 }).notNull().default('ON_HOLD'),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    providerPayoutId: varchar('provider_payout_id', { length: 120 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('payouts_status_chk', inList('status', ['ON_HOLD', 'APPROVED', 'PROCESSING', 'PAID', 'CANCELLED'])),
    index('payouts_seller_idx').on(t.sellerProfileId, t.status),
  ],
);

/**
 * Double-entry ledger (append-only). Every posting is a group of lines whose debits equal credits.
 * Accounts: provider_held (money held by the licensed payment partner), seller_payable, iie_fee_revenue,
 * logistics_payable.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    postingId: uuid('posting_id').notNull(),
    transactionId: uuid('transaction_id').notNull().references(() => transactions.id),
    account: varchar('account', { length: 40 }).notNull(),
    direction: varchar('direction', { length: 6 }).notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull().references(() => currencies.code),
    description: varchar('description', { length: 200 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('ledger_direction_chk', inList('direction', ['DEBIT', 'CREDIT'])),
    check('ledger_amount_chk', sql`${t.amountMinor} >= 0`),
    index('ledger_tx_idx').on(t.transactionId, t.id),
    index('ledger_posting_idx').on(t.postingId),
  ],
);

/** Append-only exchange rates. Transactions keep the rate they used; nothing is recomputed with a newer rate. */
export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: id(),
    baseCurrency: char('base_currency', { length: 3 }).notNull().references(() => currencies.code),
    quoteCurrency: char('quote_currency', { length: 3 }).notNull().references(() => currencies.code),
    rate: numeric('rate', { precision: 18, scale: 8 }).notNull(),
    source: varchar('source', { length: 60 }).notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index('exchange_rates_pair_idx').on(t.baseCurrency, t.quoteCurrency, t.effectiveAt)],
);

// ---------------------------------------------------------------- Phase 5: logistics

/**
 * Organisations IIE works with to move goods: logistics partners (carriers) and customs brokers. Configured by
 * IIE administrators; the platform never hard-codes a company. Their staff use the IIE partner portal.
 */
export const servicePartners = pgTable(
  'service_partners',
  {
    id: id(),
    kind: varchar('kind', { length: 20 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    /** Home country. A customs broker clears customs in this country. */
    countryId: uuid('country_id').notNull().references(() => countries.id),
    contactEmail: varchar('contact_email', { length: 254 }).notNull(),
    contactPhone: varchar('contact_phone', { length: 20 }).notNull(),
    /** Logistics partners: true if they clear customs themselves; otherwise the destination country's broker does. */
    clearsCustoms: boolean('clears_customs').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('service_partners_kind_chk', inList('kind', ['LOGISTICS', 'CUSTOMS_BROKER'])), index('service_partners_kind_country_idx').on(t.kind, t.countryId)],
);

/** Partner staff. Membership decides which shipments a partner user can see and update. */
export const partnerMembers = pgTable(
  'partner_members',
  {
    id: id(),
    partnerId: uuid('partner_id').notNull().references(() => servicePartners.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    addedBy: uuid('added_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [unique('partner_members_uq').on(t.partnerId, t.userId), index('partner_members_user_idx').on(t.userId)],
);

/** Trade lanes a logistics partner serves. */
export const partnerLanes = pgTable(
  'partner_lanes',
  {
    id: id(),
    partnerId: uuid('partner_id').notNull().references(() => servicePartners.id),
    laneId: uuid('lane_id').notNull().references(() => lanes.id),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique('partner_lanes_uq').on(t.partnerId, t.laneId), index('partner_lanes_lane_idx').on(t.laneId)],
);

/** One shipment per transaction, created when the seller marks the order ready for pickup. */
export const shipments = pgTable(
  'shipments',
  {
    id: id(),
    transactionId: uuid('transaction_id').notNull().unique().references(() => transactions.id),
    /** Null until IIE has a partner for the lane (or assigns one). */
    logisticsPartnerId: uuid('logistics_partner_id').references(() => servicePartners.id),
    /** Set when the logistics partner does not clear customs itself. */
    customsBrokerId: uuid('customs_broker_id').references(() => servicePartners.id),
    pickupAddress: jsonb('pickup_address').$type<Record<string, string | null>>().notNull(),
    pickupContact: jsonb('pickup_contact').$type<{ name: string; phone: string | null }>().notNull(),
    deliveryAddress: jsonb('delivery_address').$type<Record<string, string | null>>().notNull(),
    deliveryContact: jsonb('delivery_contact').$type<{ name: string; phone: string | null }>().notNull(),
    /** Weight used for the shipping price at checkout. */
    declaredWeightGrams: integer('declared_weight_grams').notNull(),
    /** Packed weight given by the seller. */
    parcelWeightGrams: integer('parcel_weight_grams').notNull(),
    /** Weight measured by the partner at pickup. */
    actualWeightGrams: integer('actual_weight_grams'),
    weightFlagged: boolean('weight_flagged').notNull().default(false),
    pickupNotes: text('pickup_notes').notNull().default(''),
    pickupScheduledFor: timestamp('pickup_scheduled_for', { withTimezone: true }),
    pickedUpAt: timestamp('picked_up_at', { withTimezone: true }),
    trackingReference: varchar('tracking_reference', { length: 60 }),
    customsEntryNumber: varchar('customs_entry_number', { length: 60 }),
    /** Duties and taxes assessed by customs, paid by the buyer on arrival (not collected by IIE). */
    dutiesAssessedMinor: bigint('duties_assessed_minor', { mode: 'bigint' }),
    currencyCode: char('currency_code', { length: 3 }).notNull().references(() => currencies.code),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('shipments_weights_chk', sql`${t.declaredWeightGrams} > 0 and ${t.parcelWeightGrams} > 0`),
    index('shipments_logistics_idx').on(t.logisticsPartnerId),
    index('shipments_broker_idx').on(t.customsBrokerId),
  ],
);

/** Append-only tracking history: every update by a partner, broker, seller or IIE, with location and note. */
export const shipmentEvents = pgTable(
  'shipment_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    shipmentId: uuid('shipment_id').notNull().references(() => shipments.id),
    step: varchar('step', { length: 40 }).notNull(),
    actorType: varchar('actor_type', { length: 20 }).notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    partnerId: uuid('partner_id').references(() => servicePartners.id),
    location: varchar('location', { length: 120 }),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('shipment_events_shipment_idx').on(t.shipmentId, t.id)],
);

/** Proof of delivery (append-only). Recipient name and time required; photo and signature optional. */
export const deliveryProofs = pgTable('delivery_proofs', {
  id: id(),
  shipmentId: uuid('shipment_id').notNull().unique().references(() => shipments.id),
  recipientName: varchar('recipient_name', { length: 120 }).notNull(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }).notNull(),
  photoMediaId: uuid('photo_media_id').references(() => mediaAssets.id),
  signatureMediaId: uuid('signature_media_id').references(() => mediaAssets.id),
  note: text('note'),
  recordedBy: uuid('recorded_by').notNull().references(() => users.id),
  createdAt: createdAt(),
});
