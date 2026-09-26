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
