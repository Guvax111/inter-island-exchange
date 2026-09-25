# IIE Platform Architecture

**Status:** Proposed — for review before Phase 1 begins (D1 decided; D2–D6 open)
**Companion:** [`IIE_PLATFORM_AUDIT.md`](./IIE_PLATFORM_AUDIT.md)

The audit found no existing IIE code, so this is a greenfield architecture. It reuses the
frontend toolkit already in this repository (React, TypeScript, Tailwind, shadcn/ui, zod,
react-hook-form, TanStack Query).

---

## 1. Principles

1. **One transaction record.** Every commercial event hangs off a single `transactions` row.
2. **Server is the authority.** Prices, totals, permissions, and state transitions are computed
   and enforced on the server and in the database. The frontend only displays and requests.
3. **Configuration, not code, for anything regional.** Countries, currencies, fees, lanes,
   restricted products, partners, and payment methods are data.
4. **Providers behind interfaces.** Payment, FX, KYC, compliance screening, logistics,
   notifications, file storage, and search each have an interface plus a sandbox implementation.
5. **Money is append-only.** Financial facts are inserted, never updated in place. Corrections
   are new rows.
6. **IIE does not custody funds.** The software models *payment holds* executed by a licensed
   provider. Wording in the UI is "Transaction Safeguard", never "escrow", unless legal approves.
7. **Modular monolith first.** One deployable backend with strict module boundaries; split into
   services only when a module has a proven scaling or ownership reason.

## 2. System context

```
                ┌──────────── Buyers / Sellers / Partners / Admins (mobile-first browsers) ───────────┐
                                                        │ HTTPS
                                          ┌─────────────▼─────────────┐
                                          │  Web app (Next.js, SSR)   │  public site, dashboards, portals
                                          └─────────────┬─────────────┘
                                                        │ /api/v1 (REST + OpenAPI)
┌────────────────────────────────────────────────────────▼────────────────────────────────────────────────────┐
│                                   IIE API — modular monolith (NestJS)                                        │
│  identity · rbac · countries · catalog · search · cart · checkout · transactions · payments · fx ·          │
│  logistics · customs-docs · compliance · disputes · payouts · notifications · messaging · reviews · admin   │
│  audit                                                                                                       │
│      │ domain events (transactional outbox)                                                                 │
│      ▼                                                                                                       │
│  Worker process (BullMQ): notifications, webhooks out, provider polling, scheduled jobs (auto-confirm,      │
│  dispute-window expiry, FX refresh, reconciliation)                                                          │
└───────┬──────────────────┬───────────────────┬────────────────────┬────────────────────┬────────────────────┘
        │                  │                   │                    │                    │
   PostgreSQL          Redis              Object storage      Provider adapters     Observability
 (system of record)  (queues, rate      (S3-compatible:       payment · fx · kyc ·   (logs, traces,
                      limits, cache)     images, documents)   screening · logistics · errors, metrics)
                                                              email · sms
```

## 3. Technology choices

| Concern | Choice | Why | Alternative |
|---|---|---|---|
| Repo layout | pnpm + Turborepo monorepo: `apps/web`, `apps/api`, `apps/worker`, `packages/shared`, `packages/ui`, `packages/db` | One place for shared zod schemas and types across web and API | Separate repos (more overhead) |
| Web | **Next.js (App Router) + React + Tailwind + shadcn/ui** | Product, storefront, and country pages need server rendering for SEO and fast first paint on slow mobile networks. The existing shadcn components move over unchanged | Keep Vite SPA + separate prerender — workable but weaker SEO |
| API | **NestJS (TypeScript)** on Node LTS | Module boundaries, guards for RBAC, first-class OpenAPI generation, DI for provider adapters | Fastify + hand-rolled modules |
| Validation | **zod** schemas in `packages/shared`, used by both web forms and API | One definition of every payload | class-validator |
| Database | **PostgreSQL 16** (managed) | ACID for money, row-level security available, full-text search, JSONB for provider payloads | — |
| ORM / migrations | **Prisma** (or Drizzle) with SQL migrations checked in; raw SQL for triggers, RLS, sequences | Typed access plus control where needed | TypeORM |
| Auth | Session-based auth in the API (httpOnly, `Secure`, `SameSite=Lax` cookies; server-side session table); argon2id hashing; TOTP MFA; verification via email/SMS provider | Revocable sessions and device list are requirements; avoids long-lived JWTs in the browser | Managed auth (Supabase Auth, Auth0, Clerk) — acceptable if it supports custom roles and server-side session revocation |
| Queue / jobs | **Redis + BullMQ** | Retries, delays (dispute window), scheduled jobs | pg-boss (Postgres-only) |
| Files | S3-compatible storage, private buckets, pre-signed URLs, virus scan on upload | Documents and evidence must not be public | — |
| Search | Postgres full-text + trigram behind a `SearchProvider` interface | Enough for pilot scale; swap to OpenSearch/Meilisearch later without touching callers | — |
| Tests | Vitest (unit), Supertest against a real Postgres (integration), Playwright (E2E) | Critical money paths run against a real DB | — |
| Observability | OpenTelemetry → hosted APM; Sentry for errors; structured JSON logs | | |
| Hosting | Containers on a managed platform (AWS ECS/Fargate, GCP Cloud Run, Render, or Fly.io); managed Postgres with PITR; region `us-east-1` or closest available to the Eastern Caribbean | | |

## 4. Environments and configuration

| Environment | Purpose | Payment provider | Data |
|---|---|---|---|
| `local` | Developer machines (docker-compose: Postgres, Redis, MinIO, Mailpit) | `SandboxPaymentProvider` (in-process fake) | Seed script |
| `staging` | Pre-release, partner UAT | Real provider **sandbox** | Synthetic data only |
| `production` | Live | Real provider live keys | Real data |

- All config via environment variables validated at boot by a zod schema; the process refuses to
  start on missing/invalid config.
- Secrets live in the platform secret manager, never in the repo. `.env.example` documents keys.
- `production` refuses to boot if any provider is set to a sandbox/fake implementation.
- Feature flags (DB table) gate modules per country and per environment.

## 5. Module boundaries

Each module owns its tables. Other modules call its service interface or react to its events;
they never write its tables directly.

| Module | Owns | Publishes events (examples) |
|---|---|---|
| `identity` | users, sessions, devices, verification tokens, MFA | `user.registered`, `user.verified`, `user.suspended` |
| `rbac` | roles, permissions, role assignments (with optional country scope) | `role.granted` |
| `profiles` | buyer_profiles, seller_profiles, businesses, addresses | `seller.submitted`, `seller.approved` |
| `countries` | countries, currencies, lanes, tax/duty rules, ports, country partners | `country.updated` |
| `catalog` | categories, products, variants, images, inventory, hs_codes | `product.submitted`, `product.approved`, `inventory.low` |
| `search` | search index (derived) | — |
| `cart` | carts, cart_items | — |
| `checkout` | quotes (price snapshots) | `quote.created` |
| `transactions` | orders, order_items, transactions, transaction_events | `transaction.state_changed` |
| `payments` | payment_intents, payment_events, refunds, ledger_entries | `payment.succeeded`, `payment.failed`, `refund.completed` |
| `fx` | exchange_rates | `fx.rates_refreshed` |
| `payouts` | payout_accounts, payouts | `payout.sent` |
| `logistics` | logistics_partners, shipments, shipment_events | `shipment.status_changed` |
| `customs` | customs_documents | `customs.hold`, `customs.cleared` |
| `compliance` | compliance_checks, restricted_product_rules, kyc_verifications | `compliance.hold`, `compliance.cleared` |
| `disputes` | disputes, dispute_evidence, dispute_messages | `dispute.opened`, `dispute.resolved` |
| `notifications` | notifications, notification_preferences, templates | — |
| `messaging` | conversations, messages | `message.sent` |
| `reviews` | reviews | `review.created` |
| `audit` | audit_logs (append-only) | — |

## 6. Central transaction engine

### 6.1 What a "transaction" is

A cart may contain items from several sellers. Checkout produces one **order** per seller, and
each order has exactly one **transaction**. The transaction is the unit that is paid, shipped,
cleared through customs, disputed, and paid out. A multi-seller checkout is a `checkout_group`
that owns several transactions and one or more payment intents.

(For the MVP, checkout is restricted to one seller at a time.)

### 6.2 Transaction ID

Format: `IIE-{originCode}-{destinationCode}-{sequence}`, e.g. `IIE-SLU-SVG-000001`.

- `originCode`/`destinationCode` come from a configurable `countries.iie_code` column. Note the
  brief's examples (`SLU`, `SVG`) are **not** ISO 3166 alpha-3 (those are `LCA` and `VCT`).
  Countries store ISO alpha-2 and alpha-3 for data exchange *and* `iie_code` for display IDs, so
  the brand format is kept without breaking interoperability.
- `sequence` comes from a single Postgres sequence (`transaction_number_seq`), zero-padded to at
  least 6 digits and allowed to grow. One global sequence avoids per-lane locking and makes every
  number unique on its own.
- The primary key is a UUID; the IIE ID is a unique, immutable, human-facing column.

### 6.3 State machine

Full detail goes in `IIE_TRANSACTION_STATE_MACHINE.md` (Phase 3). Summary:

```
CREATED → AWAITING_PAYMENT → PAYMENT_PROCESSING → PAYMENT_CONFIRMED
  → AWAITING_SELLER_CONFIRMATION → SELLER_CONFIRMED → PREPARING_SHIPMENT
  → PICKUP_SCHEDULED → PICKED_UP → EXPORT_PROCESSING → IN_TRANSIT → ARRIVED_DESTINATION
  → CUSTOMS_PROCESSING → CUSTOMS_CLEARED → OUT_FOR_DELIVERY → DELIVERED
  → DELIVERY_CONFIRMED → DISPUTE_WINDOW → PAYOUT_APPROVED → PAYOUT_PROCESSING → COMPLETED

Exceptional: PAYMENT_FAILED, CANCELLED, CUSTOMS_HOLD, COMPLIANCE_HOLD, DISPUTED,
             REFUNDED, PARTIALLY_REFUNDED
```

Implementation rules:

- Transitions are declared once as a table in code: `from → to`, the **actor roles** allowed,
  **guards** (e.g. `PAYOUT_APPROVED` requires no open dispute and compliance `CLEAR`), and
  **effects** (events emitted).
- One function, `transition(transactionId, to, actor, reason, metadata)`, is the only way to
  change state. It runs in a DB transaction with `SELECT … FOR UPDATE` on the row, checks
  `from`, guards and actor, updates `transactions.status` + `version`, inserts a
  `transaction_events` row, and writes outbox events.
- Holds (`CUSTOMS_HOLD`, `COMPLIANCE_HOLD`, `DISPUTED`) record the state they interrupted and
  return to it or move to a resolution state.
- Sub-statuses (`payment_status`, `shipment_status`, `customs_status`, `compliance_status`,
  `dispute_status`, `payout_status`) are denormalised onto the transaction for dashboards, and
  updated only by the owning module through the same engine.
- Logistics statuses are richer than transaction states; a mapping table drives which shipment
  events advance the transaction.

### 6.4 Price snapshot and money

- All amounts stored as **integer minor units** (`bigint`) plus an ISO 4217 currency code.
  No floats anywhere in the money path.
- At checkout a **quote** freezes: unit prices, quantities, product title/SKU/HS code/origin,
  shipping, duty/tax estimates (flagged as estimates), platform fee, FX rate(s) used with
  provider + timestamp, and total. The order is created from the quote, never from live product
  rows. Quotes expire (e.g. 15 min) and are re-validated at payment time.
- A double-entry `ledger_entries` table records every movement (buyer charge, platform fee,
  seller payable, refund, payout) so balances reconcile to the provider's statements.
- `transaction_events`, `payment_events`, `ledger_entries`, `audit_logs` are append-only:
  the application DB role has `INSERT`/`SELECT` only, enforced by grants and a trigger that
  rejects `UPDATE`/`DELETE`.

### 6.5 Checkout validation pipeline

Ordered, each step returns pass / fail / warning with a reason code shown to the buyer:

1. Buyer account active and verification level allows the amount.
2. Destination address in an enabled country.
3. Seller `ACTIVE`; seller country enabled for export.
4. Lane (origin → destination) enabled and has a logistics option.
5. Each product `ACTIVE`, inventory reservable (reservation row with TTL, decremented on payment).
6. Product eligibility: restricted-product rules for (HS code / category) × origin × destination.
7. Price, shipping, fee, duty/tax estimate calculation → quote.
8. Payment method available for buyer country + currency.
9. Create order(s) + transaction(s) in `CREATED` → `AWAITING_PAYMENT`.

## 7. Data model (core entities)

Full column-level schema goes in `IIE_DATABASE_SCHEMA.md` (Phase 1). Key relationships:

```
users ─1:1─ buyer_profiles
users ─1:N─ seller_profiles ─N:1─ businesses
users ─N:M─ roles (user_roles, optional country_id scope) ─N:M─ permissions
countries ─N:1─ currencies ;  lanes(origin_country, destination_country)
seller_profiles ─1:N─ products ─1:N─ product_variants ─1:1─ inventory
products ─N:1─ categories ; products ─N:1─ hs_codes ; products ─1:N─ product_images
restricted_product_rules (hs_code_prefix | category) × (origin_country?) × (destination_country)
carts ─1:N─ cart_items ─N:1─ product_variants
checkout_groups ─1:N─ orders ─1:N─ order_items (snapshot columns)
orders ─1:1─ transactions ─1:N─ transaction_events
transactions ─1:N─ payment_intents ─1:N─ payment_events
transactions ─1:N─ refunds ; transactions ─1:N─ payouts ; transactions ─1:N─ ledger_entries
transactions ─1:N─ shipments ─1:N─ shipment_events ; shipments ─N:1─ logistics_partners
transactions ─1:N─ customs_documents ; transactions ─1:N─ compliance_checks
transactions ─1:N─ disputes ─1:N─ dispute_evidence
transactions ─1:N─ reviews ; notifications ─N:1─ users ; audit_logs (actor, entity, before, after)
exchange_rates (base, quote, rate, provider, fetched_at) — referenced by id from quotes/transactions
```

`transactions` columns (abridged): `id`, `iie_id`, `order_id`, `buyer_id`, `seller_id`,
`origin_country_id`, `destination_country_id`, `status`, `version`, the six sub-statuses,
`transaction_currency`, `buyer_currency`, `payout_currency`, `fx_rate_id`, `subtotal_minor`,
`shipping_minor`, `duties_taxes_minor`, `platform_fee_minor`, `other_fees_minor`, `total_minor`,
`dispute_window_ends_at`, timestamps.

Indexes: every FK; `transactions(status)`, `(buyer_id, created_at)`, `(seller_id, created_at)`;
`products(seller_id, status)`, GIN full-text on product search vector; `shipments(tracking_number)`;
`audit_logs(entity_type, entity_id, created_at)`.

## 8. Identity, roles and permissions

- Permissions are fine-grained strings (`product.create`, `transaction.read.own`,
  `transaction.transition.pickup`, `country.manage`, `payout.approve`, …). Roles are bundles.
- The 14 roles in the brief are seed data. "Buyer + Seller" is two role assignments, not a role.
  Country Administrator is a role assignment scoped by `country_id`.
- Enforcement in three layers: (1) NestJS guard checks permission on every route (deny by
  default); (2) service layer checks **ownership / scope** (buyer sees own transactions, partner
  sees assigned shipments, country admin sees own country); (3) Postgres row-level security on
  the most sensitive tables as defence in depth.
- Account statuses: `DRAFT → PENDING_VERIFICATION → UNDER_REVIEW → ACTIVE`, plus `SUSPENDED`,
  `REJECTED`, `CLOSED`. Seller adds `APPROVED` between review and active. Commercial actions
  require `ACTIVE`.
- Buyer verification levels (`BASIC`, `VERIFIED`, `BUSINESS`) map to configurable limits in a
  `verification_limits` table per country.

## 9. Provider abstraction

Pattern for every external dependency:

```ts
interface PaymentProvider {
  readonly key: string;                       // "sandbox", "<provider-name>"
  createIntent(input: CreateIntentInput): Promise<PaymentIntentResult>;
  authorize?(intentId: string): Promise<AuthorizationResult>;
  capture(intentId: string, amount: Money): Promise<CaptureResult>;
  refund(paymentId: string, amount: Money, reason: string): Promise<RefundResult>;
  payout(input: PayoutInput): Promise<PayoutResult>;
  parseWebhook(headers: Headers, rawBody: Buffer): Promise<ProviderEvent>; // verifies signature
}
```

- A registry resolves the provider per **country + payment method** from config.
- Each adapter lives in `apps/api/src/providers/<kind>/<name>/` and has contract tests shared
  across implementations.
- Inbound webhooks are stored raw first (`provider_webhooks` table, unique on provider event id
  for idempotency), then processed by the worker.
- Same shape for `FxProvider`, `KycProvider`, `ScreeningProvider`, `LogisticsProvider`
  (optional — partners without APIs use the portal), `EmailProvider`, `SmsProvider`,
  `StorageProvider`, `SearchProvider`.

**Payments and regulation:** IIE's software models authorise → capture → hold → release. The
hold must be executed by a licensed marketplace-payments / escrow / custodial provider (funds
sit with that provider, and release is an API call or a documented manual instruction). The
choice of provider for the ECCU and other CARICOM currencies is an open business decision
(§13) and does not change this design.

## 10. Multi-currency

- Currencies: XCD, USD, TTD, BBD, JMD, GYD seeded; `minor_unit` per currency (all 2 today).
- `exchange_rates` is append-only; the FX module refreshes from the configured provider on a
  schedule and admins can enter manual rates (with audit) where no feed exists.
- A quote records the `exchange_rate` rows used and any conversion fee; the transaction keeps
  those ids forever. Nothing recalculates a transaction with a newer rate.
- Display conversion (showing a buyer an approximate price in their currency) is visually
  distinguished from the settlement currency.

## 11. Events, notifications, audit

- **Transactional outbox:** domain events are inserted in the same DB transaction as the state
  change; the worker publishes them to BullMQ. No lost or phantom notifications.
- Notification service maps events → templates → channels (in-app, email; SMS and push later)
  per user preferences.
- **Audit log** records actor, role, action, entity, before/after JSON diff, IP, user agent,
  session id, request id. Written by an interceptor for all admin/partner mutations and by the
  services for financial and compliance actions. Append-only.

## 12. Security baseline

Server-side authz on every route; zod validation at every boundary; parameterised queries only
(ORM); argon2id; rate limiting on auth, checkout and webhooks (Redis); CSRF tokens for cookie
sessions; strict CSP and security headers; private file buckets + signed URLs + upload scanning;
no card data stored (provider-hosted fields/redirect only, keeping PCI scope to SAQ-A);
secrets in a secret manager; dependency scanning and `npm audit` in CI; TypeScript `strict`
everywhere; encrypted backups with point-in-time recovery; PII minimisation and data-retention
policy. Detail goes in `IIE_SECURITY.md`.

## 13. Open decisions (need owner input)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Where IIE lives (see audit §0) | **Decided:** this repository, `Guvax111/inter-island-exchange` |
| D2 | Payment partner(s) for ECCU (XCD) pilot | Begin due diligence now; architecture is provider-agnostic |
| D3 | Managed auth vs. in-house sessions | In-house sessions in the API (control over device list, suspension, audit) |
| D4 | Hosting provider and region | Managed containers + managed Postgres in the nearest region to the Eastern Caribbean |
| D5 | Logistics partner for SLU→SVG lane | Needed before Phase 5 UAT |
| D6 | Next.js vs. keep Vite SPA | Next.js for SEO and mobile first load |

## 14. Documents to produce per phase

| Document | Phase |
|---|---|
| `IIE_DATABASE_SCHEMA.md`, `IIE_COUNTRY_ENGINE.md`, `IIE_SECURITY.md`, `IIE_DEVELOPMENT_ROADMAP.md` | 1 |
| `IIE_API_DOCUMENTATION.md` (generated from OpenAPI, kept current each phase) | 1 onward |
| `IIE_TRANSACTION_STATE_MACHINE.md` | 3 |
| `IIE_PAYMENT_ARCHITECTURE.md` | 4 |
| `IIE_LOGISTICS_ARCHITECTURE.md` | 5 |
| `IIE_COMPLIANCE_ARCHITECTURE.md` | 6 |
