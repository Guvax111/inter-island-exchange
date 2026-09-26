# IIE Database Schema

**Engine:** PostgreSQL 16 · **Status:** Phase 1 tables implemented · **Source of truth:** `apps/api/src/db/schema.ts`
(Drizzle) and the SQL migrations in `apps/api/drizzle/`.

## Rules

- Primary keys are UUIDs (`gen_random_uuid()`), except append-only logs, which use `bigserial` for ordering.
- Every foreign key is declared; foreign-key columns used for lookups are indexed.
- Status columns are `varchar` with `CHECK` constraints (easier to evolve than Postgres enums).
- All timestamps are `timestamptz`.
- Money (from Phase 2): `bigint` minor units plus a `char(3)` currency code. No floating point.
- Append-only tables reject `UPDATE`, `DELETE` and `TRUNCATE` with a trigger (`iie_reject_modification`). Today: `audit_logs`. From Phase 3: `transaction_events`, `payment_events`, `ledger_entries`.
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
categories, products, product_variants, inventory, product_images, hs_codes, restricted_product_rules (Phase 2/6);
carts, cart_items, checkout_groups, orders, order_items, transactions, transaction_events, notifications (Phase 3);
payment_intents, payment_events, refunds, payouts, payout_accounts, ledger_entries, exchange_rates, provider_webhooks (Phase 4);
logistics_partners, shipments, shipment_events, customs_documents (Phase 5);
compliance_checks, kyc_verifications, disputes, dispute_evidence (Phase 6); messages, reviews (Phase 7).
