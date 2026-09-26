# IIE Database Schema

**Engine:** PostgreSQL 16 · **Status:** Phase 1–3 tables implemented · **Source of truth:** `apps/api/src/db/schema.ts`
(Drizzle) and the SQL migrations in `apps/api/drizzle/`.

## Rules

- Primary keys are UUIDs (`gen_random_uuid()`), except append-only logs, which use `bigserial` for ordering.
- Every foreign key is declared; foreign-key columns used for lookups are indexed.
- Status columns are `varchar` with `CHECK` constraints (easier to evolve than Postgres enums).
- All timestamps are `timestamptz`.
- Money (from Phase 2): `bigint` minor units plus a `char(3)` currency code. No floating point.
- Append-only tables reject `UPDATE`, `DELETE` and `TRUNCATE` with a trigger (`iie_reject_modification`). Today: `audit_logs`, `inventory_movements`, `transaction_events`. `transactions.iie_id` cannot be changed. From Phase 3: `transaction_events`, `payment_events`, `ledger_entries`.
- Secrets are never stored raw: session tokens and one-time tokens are SHA-256 hashes; TOTP secrets are AES-256-GCM encrypted; passwords are argon2id.
- Schema changes: edit `schema.ts`, run `pnpm --filter @iie/api db:generate`, review the SQL, commit both. CI fails if they drift (`drizzle-kit check`).

## Phase 1 tables

### Country engine

| Table | Purpose | Key columns |
|---|---|---|
| `currencies` | ISO 4217 currencies | `code` PK, `symbol`, `minor_unit` |
| `countries` | One row per country; all regional behaviour is configuration | `iso_alpha2` UQ, `iso_alpha3` UQ, `iie_code` UQ (used in transaction IDs), `slug` UQ (public page), `currency_code` FK, `marketplace_enabled`, `settings` JSONB (`settings.public` is shown publicly) |
| `lanes` | Allowed origin → destination trade routes | `origin_country_id` FK, `destination_country_id` FK, UQ(origin, destination), CHECK origin ≠ destination, `enabled` |
| `verification_limits` | Transaction limits by country and buyer level (enforced at checkout, Phase 3) | UQ(country_id, level), `max_transaction_minor`, `currency_code` FK |

### Identity and access

| Table | Purpose | Key columns |
|---|---|---|
| `users` | Accounts | `email` UQ (lower-cased), `password_hash`, `country_id` FK, `status` CHECK (DRAFT…CLOSED), `email_verified_at`, `phone`, `failed_login_count`, `locked_until`, `onboarding_submitted_at` |
| `sessions` | Server-side sessions | `token_hash` UQ, `csrf_token`, `ip`, `user_agent`, `last_seen_at`, `expires_at`, `revoked_at` |
| `verification_tokens` | Email verification and password reset links | `purpose` CHECK, `token_hash` UQ, `expires_at`, `used_at` |
| `mfa_factors` | TOTP two-step verification (one per user) | `user_id` UQ, `secret_encrypted`, `confirmed_at` |
| `roles`, `permissions`, `role_permissions` | Role catalogue, synced from `@iie/shared` by the seed | `roles.key` UQ, `permissions.key` UQ |
| `user_roles` | Role assignments, optionally limited to a country | UQ(user, role, country) NULLS NOT DISTINCT, `granted_by` FK |

### Profiles

| Table | Purpose | Key columns |
|---|---|---|
| `addresses` | Delivery and business addresses | `user_id` FK, `country_id` FK |
| `businesses` | Registered businesses (buyers or sellers) | UQ(country_id, registration_number), `tax_id`, `website` |
| `buyer_profiles` | One per buyer | PK `user_id`, `party_type`, `business_id` FK, `verification_level` (BASIC/VERIFIED/BUSINESS), `default_address_id` FK |
| `seller_profiles` | One per seller | `user_id` UQ, `legal_name`, `business_id` FK, `category`, `country_id` FK, `address_id` FK, `status` CHECK (DRAFT…REJECTED), review fields |
| `account_deletion_requests` | Customer requests to close an account | `status` CHECK, `processed_by` FK |

### Audit and events

| Table | Purpose | Key columns |
|---|---|---|
| `audit_logs` | **Append-only.** Who did what, before/after, from where | `actor_user_id`, `actor_roles[]`, `action`, `entity_type`, `entity_id`, `before`/`after` JSONB, `ip`, `user_agent`, `session_id`, `request_id`; indexes on (entity) and (actor) |
| `outbox_events` | Transactional outbox; events written with the change, delivered by the worker with retries | `type`, `payload` (one-time tokens removed after delivery), `available_at`, `processed_at`, `attempts`, `last_error` (prefixed `DEAD:` after 10 attempts) |

## Phase 2 tables (marketplace)

| Table | Purpose | Key columns |
|---|---|---|
| `seller_profiles` (new columns) | Pilot payout confirmation | `payout_setup_confirmed_at`, `payout_setup_confirmed_by` FK, `payout_setup_note` |
| `seller_storefronts` | Public store, created on approval | `seller_profile_id` UQ FK, `slug` UQ, `display_name`, `description`, `logo_media_id` FK, `shipping_origin`, `return_policy`, `store_policies` |
| `media_assets` | Uploaded images (stored via the StorageProvider) | `owner_user_id` FK, `kind` CHECK (PRODUCT_IMAGE, STORE_LOGO), `storage_key` UQ, `content_type`, `width`, `height`, `bytes` |
| `categories` | Category tree | `parent_id` FK → categories (not self), `slug` UQ, `active`, `sort_order` |
| `hs_codes` | Informational HS headings | `code` PK, `description` |
| `products` | Listings | `seller_profile_id` FK, `category_id` FK, `country_of_origin_id` FK, `hs_code`, weight and dimensions (g, mm), `attributes` JSONB, `status` CHECK, review fields, `published_at`, `search_vector` (generated tsvector, GIN index) + trigram index on `title` |
| `product_variants` | Sellable options | `product_id` FK, UQ(`seller_profile_id`, `sku`), `price_minor` bigint CHECK > 0, `currency_code` FK, `archived` |
| `inventory` | Stock per variant | PK `variant_id`, `quantity_on_hand` ≥ 0, `quantity_reserved` (≤ on hand; used from Phase 3) |
| `inventory_movements` | **Append-only** stock ledger | `variant_id` FK, `delta`, `quantity_after`, `reason` CHECK (INITIAL, STOCK_COUNT, SALE, RETURN, CORRECTION), `actor_user_id` |
| `product_images` | Ordered product photos | `product_id` FK, `media_id` UQ FK, `alt_text`, `sort_order` |
| `carts`, `cart_items` | One cart per buyer; quantities only (prices always read live) | `carts.user_id` UQ; UQ(`cart_id`, `variant_id`), quantity 1–99 |
| `saved_products`, `saved_sellers` | Buyer favourites | composite PKs |

## Phase 3 tables (checkout and transactions)

| Table | Purpose | Key columns |
|---|---|---|
| `seller_storefronts.fee_payer` (new column) | Seller's choice of who pays the IIE fee | BUYER, SELLER or null (platform default) |
| `lane_shipping_rates` | Shipping price bands per trade lane | `lane_id` FK, `max_weight_grams`, `price_minor`, `currency_code`, `is_placeholder`, `active` |
| `fee_rules` | IIE platform fee | `lane_id` (null = global) UQ NULLS NOT DISTINCT, `percent_bps` 0–10000, `default_payer` |
| `duty_estimates` | Duty/VAT estimates | UQ(`destination_country_id`, `hs_prefix`), `caricom_origin_duty_bps`, `other_origin_duty_bps`, `vat_bps`, `notes`, `is_placeholder` |
| `quotes` | Frozen checkout for one seller | `buyer_user_id`, `seller_profile_id`, `address_id`, `snapshot` JSONB (all lines and amounts), `total_minor`, `expires_at`, `used_at` |
| `orders` | One per placed quote | `quote_id` UQ, `delivery_address` JSONB snapshot |
| `order_items` | Price and product snapshot | `sku`, `title`, `variant_name`, `hs_code`, `country_of_origin`, `unit_weight_grams`, `unit_price_minor`, `quantity`, `line_total_minor` |
| `transactions` | **The central record** (see `IIE_TRANSACTION_STATE_MACHINE.md`) | `iie_id` UQ (immutable), `order_id` UQ, buyer, seller, origin, destination, `status`, `version`, `held_from_status`, six sub-statuses, currencies + `fx_rate`/`fx_source`/`fx_recorded_at`, all amounts in minor units, `fee_payer`, `duties_collected`, `payment_due_at` |
| `transaction_events` | **Append-only** event log | `from_status`, `to_status`, `actor_type`, `actor_user_id`, `reason`, `metadata` |
| `inventory_reservations` | Stock held for unpaid orders | `transaction_id`, `variant_id`, `quantity`, `expires_at`, `released_at`, `consumed_at` |
| `notifications` | In-app notifications | `user_id`, `type`, `title`, `body`, `link`, `transaction_id`, `read_at` |

Sequence `transaction_number_seq` numbers IIE IDs.

**Public visibility** is one rule, used by search, product pages, images and the cart
(`apps/api/src/catalog/visibility.ts`): product `ACTIVE` or `OUT_OF_STOCK`, seller `ACTIVE`, seller's account
`ACTIVE`, storefront present, seller's country marketplace open.

## Relationship overview

```
currencies 1─N countries 1─N lanes (as origin / destination)
countries 1─N users 1─N sessions | verification_tokens | addresses | account_deletion_requests
users 1─1 mfa_factors ; users 1─1 buyer_profiles ; users 1─1 seller_profiles
users N─M roles via user_roles (optional country scope) ; roles N─M permissions via role_permissions
businesses 1─N buyer_profiles / seller_profiles
users 1─N audit_logs (as actor)
```

## Planned tables (later phases)

Designed in [`IIE_PLATFORM_ARCHITECTURE.md` §7](./IIE_PLATFORM_ARCHITECTURE.md#7-data-model-core-entities):
restricted_product_rules (Phase 6);
payment_intents, payment_events, refunds, payouts, payout_accounts, ledger_entries, exchange_rates, provider_webhooks (Phase 4);
logistics_partners, shipments, shipment_events, customs_documents (Phase 5);
compliance_checks, kyc_verifications, disputes, dispute_evidence (Phase 6); messages, reviews (Phase 7).
