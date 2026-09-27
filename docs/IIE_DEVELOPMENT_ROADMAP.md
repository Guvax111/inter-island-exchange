# IIE Development Roadmap

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | Audit, architecture | **Done** |
| 1 | Core foundation: repo, auth, roles, profiles, country engine, database | **Done** (see Phase 1 result below) |
| 2 | Marketplace: seller approval, storefronts, products, categories, search, cart | **Done** (see Phase 2 result below) |
| 3 | Orders and transaction engine: checkout, orders, state machine, notifications | **Done** (see Phase 3 result below) |
| 4 | Payments: provider abstraction, sandbox, multi-currency, refunds | **Done on the sandbox provider** (see Phase 4 result below); staging package for St. Vincent ready |
| 5 | Logistics: partners, shipments, tracking, delivery confirmation | **Done** (see Phase 5 result below); partner to be selected |
| 6 | Disputes, payout release, seller verification, HS tariffs | **Done** (see Phase 6 result below); tariff file to be imported |
| 7 | Administration, analytics and settlement | **Planned — awaiting decisions** (below) |
| 8 | Production readiness | Not started |

Phase scope and exit criteria: [`IIE_PLATFORM_AUDIT.md` §20](./IIE_PLATFORM_AUDIT.md#20-prioritised-implementation-plan).

---

## Phase 1 plan — Core foundation (as approved)

### What will be built

1. **Monorepo** (pnpm + Turborepo): `apps/web` (Next.js), `apps/api` (NestJS), `apps/worker`
   (BullMQ), `packages/shared` (zod schemas, types, money helpers), `packages/db` (Prisma schema
   and SQL migrations), `packages/ui` (shadcn/ui components carried over from the audited repo,
   rethemed for IIE).
2. **Local stack** via `docker-compose`: Postgres 16, Redis, MinIO (S3), Mailpit (catches email).
3. **Config**: zod-validated environment config per app, `.env.example`, `local` / `staging` /
   `production` separation; production refuses to boot with sandbox providers.
4. **CI** (GitHub Actions): install, typecheck (`strict: true`), lint, unit tests, integration
   tests against a Postgres service container, `pnpm audit`, build.
5. **Identity**: registration (Buyer, Seller, Buyer + Seller), email verification, login,
   logout, password reset, password change, server-side sessions in httpOnly cookies, session
   and device list with revoke, CSRF protection, rate limiting on auth routes, argon2id hashing.
   MFA (TOTP) data model and API included; UI can follow in Phase 2. Phone verification is an
   interface with a sandbox SMS provider only.
6. **Account lifecycle**: statuses `DRAFT → PENDING_VERIFICATION → UNDER_REVIEW → ACTIVE`,
   `SUSPENDED`, `REJECTED`, `CLOSED`; admin suspend/reactivate; account-deletion request workflow.
7. **RBAC**: permissions, roles (all 14 from the brief seeded), user-role assignments with
   optional country scope; deny-by-default route guard; ownership checks in services.
8. **Profiles and onboarding**: buyer profile, seller profile (individual/business), business
   record, addresses; onboarding wizard that keeps accounts non-commercial until complete.
9. **Country engine**: countries, currencies, lanes, country settings. Seed the 10 initial
   countries and 6 currencies as data; only St. Lucia and St. Vincent enabled for the pilot.
   Admin CRUD API for countries.
10. **Audit log**: append-only table plus interceptor that records every admin mutation and
    every identity/security event.
11. **Web**: public shell with the required navigation (unbuilt sections render a clear
    "Coming soon" page, tracked in the mock audit), sign-up, login, verify email, reset password,
    onboarding, a minimal account area, and a minimal admin area for users and countries.

### Files and folders created

```
package.json, pnpm-workspace.yaml, turbo.json, docker-compose.yml, .env.example, .github/workflows/ci.yml
apps/api/src/{main.ts, app.module.ts, config/, common/(guards, interceptors, errors)}
apps/api/src/modules/{identity, rbac, profiles, countries, audit, notifications(email only)}/
apps/api/src/providers/{email, sms}/{sandbox, <provider>}/
apps/api/test/  (integration tests)
apps/web/app/{(public), (auth), account, admin}/
apps/worker/src/
packages/{shared, db, ui}/
docs/IIE_DATABASE_SCHEMA.md, docs/IIE_COUNTRY_ENGINE.md, docs/IIE_SECURITY.md,
docs/IIE_API_DOCUMENTATION.md (generated from OpenAPI)
```

### Database changes (first migrations)

`users`, `sessions`, `verification_tokens`, `mfa_factors`, `roles`, `permissions`,
`role_permissions`, `user_roles` (with nullable `country_id`), `buyer_profiles`,
`seller_profiles`, `businesses`, `addresses`, `countries` (ISO alpha-2/alpha-3, `iie_code`,
currency, enabled flags, settings JSONB), `currencies` (ISO 4217, minor unit, symbol), `lanes`,
`verification_limits`, `audit_logs` (append-only, enforced by trigger and grants),
`outbox_events`, `feature_flags`. UUID primary keys, FKs and indexes on every relation.

### API changes (all under `/api/v1`, documented via OpenAPI)

- `POST /auth/register`, `/auth/login`, `/auth/logout`, `/auth/verify-email`,
  `/auth/resend-verification`, `/auth/password/forgot`, `/auth/password/reset`,
  `/auth/password/change`; `GET/DELETE /auth/sessions[/:id]`; `POST /auth/mfa/totp/*`
- `GET/PATCH /me`, `/me/buyer-profile`, `/me/seller-profile`, `/me/addresses`;
  `POST /me/onboarding/submit`; `POST /me/deletion-request`
- `GET /countries`, `GET /countries/:code`, `GET /currencies` (public)
- Admin: `GET/PATCH /admin/users`, `POST /admin/users/:id/suspend|reactivate`,
  `POST/PATCH /admin/countries`, `GET /admin/roles`, `POST /admin/users/:id/roles`,
  `GET /admin/audit-logs`

### Tests

Registration, email verification, login/logout, password reset, session revocation, rate
limiting, role guard (each role denied what it should not reach), country-scoped admin, account
status gating, audit log written for every admin mutation and immutable afterwards.

### Risks

| Risk | Mitigation |
|---|---|
| Auth is security-critical and built in-house | Well-reviewed libraries (argon2, csrf, rate limiter), full test suite, external review before Phase 8 |
| Email deliverability for verification | Use a transactional email provider with SPF/DKIM from day one in staging |
| Hosting (D4) not yet chosen | Phase 1 is fully runnable locally and in CI; hosting only needed for staging at end of phase |
| Scope creep into Phase 2 | Unbuilt navigation sections show "Coming soon" and are tracked in the mock audit |

### Decisions (approved 2026-09-25)

- Next.js for the website (D6) and login handled in IIE's own backend (D3): **approved**.
- Initial verification email provider: **Gmail** (SMTP with an App Password). See `IIE_SECURITY.md` for its limits.

---

## Phase 1 result

**Delivered:** everything in the plan above, with the differences below. 46 automated tests (40 API integration
tests against a real Postgres, 6 shared unit tests) pass, and a browser walk-through covered a St. Lucia
seller signing up, verifying and applying; a St. Vincent buyer signing up on a phone-sized screen; and an
administrator suspending an account and seeing it in the audit log.

| Planned | Delivered instead | Why |
|---|---|---|
| Turborepo | Plain pnpm workspaces (`pnpm -r`) | Three packages do not need a build orchestrator yet; add Turborepo when builds get slow |
| `packages/db`, `packages/ui`, `apps/worker` | Database code in `apps/api/src/db`; UI components in `apps/web/src/components/ui`; worker is `apps/api/src/worker.ts` | Each had one consumer; fewer packages means less build plumbing. Split out when a second consumer appears |
| Redis + BullMQ for jobs | Postgres transactional outbox, polled with `FOR UPDATE SKIP LOCKED` | No Redis needed for Phase 1; BullMQ arrives with delayed jobs (dispute windows, auto-confirmation) in Phase 3 |
| Separate `/me/buyer-profile`, `/me/seller-profile`, `/me/addresses` endpoints | One `POST /me/onboarding` taking buyer and/or seller details | Onboarding is a one-time submission; profile editing arrives with dashboards in Phase 2 |
| Playwright E2E suite in CI | Scripted browser walk-through run manually | Automated E2E in CI is scheduled for Phase 2 |

**Outstanding before real users:** a staging environment (hosting decision D4), the Gmail account and App
Password, and pushing this repository to GitHub.

---

## Phase 2 plan — Marketplace (approved 2026-09-26)

### What will be built

1. **Seller approval**: admin review queue (approve / reject / request changes, with reasons, audited);
   seller status `UNDER_REVIEW → APPROVED → ACTIVE`. For the pilot, payout setup is recorded manually so
   approved sellers can go `ACTIVE` (automated payout onboarding comes with the payment provider in Phase 4).
2. **Storefronts**: public page `/seller/{slug}` with logo, description, country, categories, policies,
   verification badge and (later) rating.
3. **Catalogue**: categories (admin-managed tree), products with variants, SKU, images (private upload →
   public CDN after moderation), inventory, weight and dimensions, country of origin, HS code, price in
   minor units + currency. Product statuses `DRAFT → PENDING_REVIEW → ACTIVE` plus `REJECTED`, `SUSPENDED`,
   `OUT_OF_STOCK`, `ARCHIVED`, with an admin review queue.
4. **Search**: Postgres full-text + trigram search behind a `SearchProvider` interface; filters for seller
   country, destination eligibility (open lanes), category, price range, currency, availability.
5. **Marketplace pages**: `/marketplace`, product pages, country pages listing local sellers and products.
6. **Cart**: server-side cart per buyer, quantity changes, removal, grouped by seller, currency display.
   Shipping, duty and fee estimates show as "calculated at checkout" until Phase 3.
7. **Seller dashboard**: overview, products, inventory, store profile.
8. **Buyer dashboard**: overview, saved products and sellers, addresses.
9. **Playwright E2E** in CI for sign-up → onboarding → seller approval → product listing → add to cart.

### Database changes

New: `seller_storefronts` (slug UQ, logo, description, policies), `categories`, `products`,
`product_variants`, `inventory` (with reservation rows for Phase 3), `product_images`, `hs_codes`,
`carts`, `cart_items`, `saved_items`; review columns on products. Object storage for images.

### API changes

`/sellers/{slug}` (public), `/products` search and detail (public), `/me/storefront`, `/me/products`
CRUD + submit for review, `/me/cart` CRUD, `/admin/sellers` review queue, `/admin/products` review queue,
`/admin/categories` CRUD.

### Risks

| Risk | Mitigation |
|---|---|
| Image uploads (storage, abuse, size on mobile data) | Pre-signed uploads, type/size limits, server-side resizing to web sizes, moderation before public |
| Listing restricted goods before the compliance engine (Phase 6) exists | Every product needs admin approval in Phase 2; HS code required |
| Search quality in Postgres at pilot scale | Fine for thousands of products; abstraction allows a search engine later |
| Staging hosting still undecided (D4) | Needed for seller UAT with real St. Lucia businesses; decide during Phase 2 |

---

## Phase 2 result

**Delivered:** everything in the Phase 2 plan. 74 API integration tests and 6 shared unit tests pass, and a
Playwright end-to-end test (now in CI) runs the pilot flow in a real browser: a St. Lucia seller signs up and is
approved, IIE confirms payout setup, the seller lists diapers with a photo, IIE approves the product, and a buyer in
St. Vincent on a phone-sized screen finds it, adds two packs to the cart and sees EC$90.00.

| Planned | Delivered instead | Why |
|---|---|---|
| Pre-signed uploads straight to object storage | Uploads go through the API, which decodes, resizes and re-encodes every image | Guarantees only real, metadata-free images are stored; simpler for the pilot's volume. Revisit if uploads become a load problem |
| Object storage adapter | `StorageProvider` interface with local disk only; production refuses local storage | The S3-compatible adapter depends on the hosting decision (D4) |
| Seller rating filter in search | Not included | There are no ratings until reviews (Phase 7); no fake ratings are shown |
| Variant archiving | Not included | Sellers set stock to 0 or archive the whole product; per-option archiving can follow |

Other notes:

- **Pilot pricing rule:** sellers price in their own country's currency. Buyers in St. Vincent also use XCD, so no
  conversion is needed yet. Multi-currency pricing arrives with the FX provider (Phase 4).
- **Lanes are enforced:** only products whose seller has an open lane to the buyer's country can go in the cart.
- **API_ORIGIN at build time:** the web app's `/api/v1` proxy target is fixed when it is built; set `API_ORIGIN`
  for the build as well as at runtime.

---

## Phase 3 plan — Orders and transaction engine (approved 2026-09-26)

### What will be built

1. **Checkout configuration (admin-managed data, no code per country):**
   - Shipping rates per trade lane, by weight band (e.g. SLU→SVG, 0–2 kg, 2–5 kg…).
   - IIE platform fee rules (percentage and/or fixed amount, per lane or country).
   - Duty and tax **estimates** per destination country, by HS code prefix. Where no estimate is configured the
     buyer sees "Duties and taxes may be payable on arrival" instead of a number.
2. **Checkout for one seller at a time** (pilot rule from Phase 2):
   - The validation pipeline from the architecture doc: buyer active and within the limit for their verification
     level, delivery address, seller active, lane open, product eligible, stock available.
   - A **quote** freezing everything: product lines, shipping, fees, duty/tax estimate, total. Valid for 15 minutes.
   - The screen shows PRODUCT COST + SHIPPING + DUTIES/TAXES + PLATFORM FEES = TOTAL.
3. **Orders and the central transaction record:**
   - Placing the order creates an order with price-snapshot lines and one **transaction** with the IIE ID
     (`IIE-SLU-SVG-000001`), using one global sequence.
   - Stock is **reserved** when the order is placed and released if payment does not arrive in time.
4. **Transaction state machine:**
   - All states from the brief are defined in one table (allowed transitions, who may trigger them, guards), with
     one `transition()` function and an append-only event log.
   - Phase 3 drives `CREATED → AWAITING_PAYMENT → CANCELLED` (buyer cancels or the payment window expires).
     Payment states arrive in Phase 4, shipping states in Phase 5.
5. **Notifications:** in-app notifications (bell icon, unread count) plus email, triggered by transaction events.
   Phase 3 events: order placed, order cancelled, payment window expiring.
6. **Screens:** checkout, buyer "My orders" with a status timeline, seller "Orders" (visible once paid, from Phase 4),
   and admin "Transactions" showing every event.
7. **Scheduled jobs** in the existing worker (Postgres-based, no Redis yet) for reservation expiry.
8. **`docs/IIE_TRANSACTION_STATE_MACHINE.md`** describing every state and transition.

### Database changes

New tables: `lane_shipping_rates`, `fee_rules`, `duty_estimates`, `quotes`, `orders`, `order_items` (price
snapshots), `transactions` (IIE ID, the six sub-statuses, all amounts in minor units), `transaction_events`
(append-only), `inventory_reservations`, `notifications`. New sequence: `transaction_number_seq`.

### API changes

`POST /me/checkout/quote` `{ sellerSlug, addressId }` · `POST /me/checkout` `{ quoteId }` ·
`GET /me/orders`, `GET /me/orders/{iieId}`, `POST /me/orders/{iieId}/cancel` · `GET /me/sales` ·
`GET /me/notifications`, `POST /me/notifications/read` · `GET /admin/transactions`, `GET /admin/transactions/{iieId}` ·
admin CRUD for shipping rates, fee rules and duty estimates.

### Risks

| Risk | Mitigation |
|---|---|
| Duty/tax figures are wrong | Shown as estimates with a clear label; configured by staff from a customs broker's guidance; can be left unconfigured |
| Fee and shipping numbers are business decisions | Configuration, not code; values below needed before UAT |
| Two buyers race for the last unit | Reservation inside the same database transaction with row locks; tested |
| Orders placed but never paid tie up stock | Reservation expiry job releases stock and cancels the order |
| No payments yet, so no end-to-end sale until Phase 4 | Phase 3 ends at "awaiting payment"; Phase 4 connects the sandbox payment provider |

### Decisions (2026-09-26)

- Platform fee: **5%**, with the option for either the buyer or the seller to pay. Implemented as an IIE default
  (buyer pays) that each seller can switch to "I pay it" in their store profile.
- Shipping: **placeholder rates** for SLU → SVG until the logistics partner's rates arrive.
- Duties: **show an estimated amount**.
- Unpaid orders hold stock for **30 minutes**.

---

## Phase 3 result

**Delivered:** everything in the Phase 3 plan, plus IIE branding (logo, favicon, brand colours) and the Contact
page with IIE's official details. 94 API tests (20 new, including pricing unit tests and a concurrent-order test),
6 shared tests and the end-to-end browser test pass. The browser test now continues past the cart: the St. Vincent
buyer checks out (EC$90.00 + EC$55.00 shipping + EC$4.50 fee = **EC$149.50**, estimated VAT on arrival EC$23.20),
places the order and receives `IIE-SLU-SVG-000001`; the seller sees the order and IIE sees the transaction with
its event log.

| Planned | Delivered instead | Why |
|---|---|---|
| "Payment window expiring" reminder | Not included | A 30-minute window is short; order-placed and order-cancelled messages cover it. Easy to add |
| Duties shown in the total | Shown as a separate **estimate payable on arrival**; not added to what the buyer pays IIE | Collecting duties means IIE (or its broker) paying customs on the buyer's behalf and settling differences: a business and legal decision (see below) |
| Separate checkout groups for multi-seller carts | Pilot rule: one seller per checkout | Matches the Phase 2 decision; groups can be added when multi-seller shipping is designed |

**Pilot pricing rules (documented in `IIE_TRANSACTION_STATE_MACHINE.md`):** fee = 5% of product cost (not of
shipping); shipping by total parcel weight; duty estimated per line on value + share of shipping at the CARICOM or
non-CARICOM rate; VAT on value + shipping + duty.

---

## Phase 4 plan — Payments (sandbox first)

### What will be built

1. **Payment provider abstraction** (`PaymentProvider`: create intent, confirm, refund, payout, verify webhook)
   with a **sandbox provider** that behaves like a real hosted payment page (success, decline and delayed outcomes)
   so the whole flow can be tested without real money.
2. **Pay now:** the order page opens the provider's hosted payment page; IIE never sees card numbers (PCI scope
   stays at the lowest level). Webhooks are stored first, verified, de-duplicated and then processed.
3. **Transaction flow:** `AWAITING_PAYMENT → PAYMENT_PROCESSING → PAYMENT_CONFIRMED → AWAITING_SELLER_CONFIRMATION`,
   or `PAYMENT_FAILED` with retry. On payment, the stock reservation is consumed and a `SALE` movement written.
   A payment that arrives after the order expired is refunded automatically.
4. **Seller confirmation:** sellers confirm (or decline, which refunds) paid orders; buyer and seller notified by
   email and in-app.
5. **Ledger:** double-entry `ledger_entries` for buyer charge, IIE fee, seller payable and refunds, so every
   transaction reconciles; admin view per transaction.
6. **Refunds:** full refunds for declined or cancelled paid orders (partial refunds arrive with disputes in Phase 6).
7. **Payout records:** payable amounts per seller accumulate; payouts themselves are released after delivery
   (Phases 5–6) through the provider or recorded manually for the pilot.
8. **FX provider abstraction** with stored, never-recomputed rates (the pilot lane stays XCD → XCD, so the rate is 1).
9. **Docs:** `IIE_PAYMENT_ARCHITECTURE.md`.

### Database changes

`payment_intents`, `payment_events` (append-only), `provider_webhooks` (raw, unique per provider event),
`refunds`, `payouts`, `ledger_entries` (append-only, double-entry), `exchange_rates` (append-only).

### API changes

`POST /me/orders/{iieId}/pay` (returns the hosted payment URL) · `POST /webhooks/payments/{provider}` (public,
signature-verified) · `POST /me/sales/{iieId}/confirm` · `POST /me/sales/{iieId}/decline` ·
`GET /admin/transactions/{iieId}/ledger` · `GET /admin/payouts`.

### Risks

| Risk | Mitigation |
|---|---|
| No licensed payment partner chosen yet (D2) | Everything runs against the sandbox provider; a real adapter is a separate, contained piece of work |
| Webhooks arrive twice, late or out of order | Store-then-process, unique provider event IDs, state machine refuses impossible moves |
| Payment succeeds after the 30-minute window | Automatic refund, and the buyer is told why |
| Regulatory: IIE must not hold funds | Funds sit with the licensed provider; IIE records instructions and ledger entries only |

### Decisions requested before Phase 4 (answered 2026-09-26, see below)

- **Payment partner (D2):** which licensed provider(s) IIE will use for St. Lucia and St. Vincent (card and/or bank
  transfer), or confirm building against the sandbox until one is contracted.
- **Duties:** keep them as an estimate paid on arrival (current behaviour), or should IIE collect estimated duties at
  checkout through its customs broker?
- **Seller confirmation time:** how long a seller has to confirm a paid order before it is refunded automatically
  (suggested: 48 hours).

### Decisions (2026-09-26)

- **Payment partner:** build against the **sandbox** until a licensed provider is contracted.
- **Duties:** an **estimate, paid on arrival**. IIE does not collect duties.
- **Seller confirmation:** **48 hours** from payment; otherwise the buyer is refunded automatically.
- **Staging:** hosted in **St. Vincent and the Grenadines**.

---

## Phase 4 result

**Delivered:** everything in the Phase 4 plan, on the sandbox provider, plus the staging package. 106 API tests
(12 new payment tests), 6 shared tests and the end-to-end browser test pass. The browser test now goes from listing
to a confirmed sale: the buyer's card is declined on the sandbox payment page, the buyer retries and pays
EC$149.50, the seller confirms within the 48 hours, and IIE sees a balanced ledger (EC$149.50 held by the provider =
EC$90.00 seller + EC$4.50 IIE fee + EC$55.00 logistics) and the seller payout on hold. The same test has been run
against the staging containers over HTTPS.

Details: [`IIE_PAYMENT_ARCHITECTURE.md`](IIE_PAYMENT_ARCHITECTURE.md) (payments) and
[`IIE_DEPLOYMENT.md`](IIE_DEPLOYMENT.md) (staging).

| Planned | Delivered instead | Why |
|---|---|---|
| `PaymentProvider.confirm` and `payout` methods | Not in the interface yet | Confirmation arrives by webhook; payout release belongs with delivery confirmation (Phase 6) and depends on the chosen provider's payout product |
| `GET /admin/transactions/{iieId}/ledger` | `GET /admin/transactions/{iieId}/money` | One view with payments, refunds, ledger lines and balances |
| Payouts "recorded manually for the pilot" | Payout rows created **on hold** and cancelled on refund; no release yet | Release needs delivery confirmation (Phases 5–6) |
| FX provider abstraction | `FxService` with administrator-entered, append-only rates (pegs seeded) | No live rate feed is needed while the pilot lane is XCD → XCD |
| — | Amount mismatch puts the order on compliance hold | A provider reporting a different amount must never be treated as paid |
| — | Staging package: Docker images, Caddy HTTPS, nightly backups with tested restore, staging banner, `noindex` | Staging is hosted in St. Vincent |

**Staging:** one server in St. Vincent runs the website, API, worker and PostgreSQL in Docker behind Caddy
(automatic HTTPS). Only ports 80/443 are exposed. Payments are sandbox-only; production refuses the sandbox.

### Needed from IIE

- A server in St. Vincent (2 vCPU, 4 GB RAM, 40 GB SSD, public IP), and a DNS record such as
  `staging.interislandexchange.com` pointing at it.
- A Gmail account and app password for staging emails.
- A second location for backup copies.

---

## Phase 5 plan — Logistics (shipments, tracking, customs, delivery)

### What will be built

1. **Logistics provider abstraction** (`LogisticsProvider`: quote, book pickup, cancel, tracking events, proof of
   delivery) with a **manual partner portal** as the first adapter: the partner's staff sign in to IIE and update
   shipments themselves. An API adapter can follow when a partner offers one. No partner names are hard-coded.
2. **Logistics partners** per lane: partner profile, staff users (role `LOGISTICS_PARTNER`, scoped to their lanes),
   service levels, and their rate cards replacing the placeholder SLU → SVG rates.
3. **Shipments:** created when the seller confirms; pickup scheduling with the seller; parcel weight and dimensions
   recorded at pickup (difference from the declared weight flagged to IIE, not charged to the buyer automatically);
   shipment number and label.
4. **Customs documents:** commercial invoice and packing list generated from the order (HS codes, country of
   origin, values), downloadable by the partner; CARICOM origin declared per line.
5. **Tracking:** the transaction moves through `PREPARING_SHIPMENT → PICKUP_SCHEDULED → PICKED_UP →
   EXPORT_PROCESSING → IN_TRANSIT → ARRIVED_DESTINATION → CUSTOMS_PROCESSING → CUSTOMS_CLEARED → OUT_FOR_DELIVERY →
   DELIVERED`, with `CUSTOMS_HOLD` as an exception. Each update is made by the partner (or IIE), audited and shown
   on the buyer's timeline; buyer and seller are emailed at key steps. `/track` becomes live for signed-in buyers.
6. **Delivery confirmation:** proof of delivery (recipient name, time, optional photo) from the partner; the buyer
   confirms receipt or reports a problem. If the buyer does nothing, the order is treated as delivered after a set
   number of days. This opens the dispute window (disputes and payout release are Phase 6).
7. **Seller pickup readiness:** "ready for pickup" action and pickup address per storefront.

### Database changes

`logistics_partners`, `logistics_partner_users`, `partner_lanes`, `shipments`, `shipment_events` (append-only),
`shipment_parcels`, `customs_documents`, `delivery_proofs`; rate cards move from placeholder rows to partner-owned
rows.

### API changes

Partner portal: `GET /partner/shipments`, `POST /partner/shipments/{id}/events`, `POST /partner/shipments/{id}/pickup`,
`POST /partner/shipments/{id}/delivery-proof` · seller: `POST /me/sales/{iieId}/ready` · buyer:
`POST /me/orders/{iieId}/confirm-delivery`, `POST /me/orders/{iieId}/report-problem` · public/buyer tracking:
`GET /track/{iieId}` · admin: partners, lanes and rate cards.

### Risks

| Risk | Mitigation |
|---|---|
| No logistics partner agreed yet | Manual partner portal needs no integration; placeholder rates stay labelled as such |
| Actual weight differs from declared | Recorded and flagged; the pilot absorbs small differences; policy needed for large ones |
| Customs holds and extra charges | `CUSTOMS_HOLD` state with reason; duties remain payable by the buyer on arrival |
| Partner staff update the wrong shipment | Partner users see only their lanes' shipments; every update is audited and reversible by IIE |

### Decisions requested before Phase 5 (answered 2026-09-26, see below)

- **Logistics partner** for St. Lucia → St. Vincent, and whether they would use the IIE partner portal or have a
  system IIE should connect to.
- **Their rates** (to replace the placeholders) and service levels (e.g. air vs sea).
- **Proof of delivery:** is a recipient name and time enough, or is a photo or signature required?
- **Automatic delivery confirmation:** how many days after `DELIVERED` if the buyer does nothing (suggested: 3).
- **Customs broker** in St. Vincent, if the partner does not clear customs itself.

### Decisions (2026-09-26)

- **Logistics partner:** to be determined; partners, once selected, use the **IIE partner portal**.
- **Shipping rates:** keep the **placeholder** rates until then.
- **Proof of delivery:** recipient name and time, **and optionally** a photo and/or a signature.
- **Automatic delivery confirmation:** **3 days** after delivery.
- **Customs:** **customs brokers in St. Vincent** when the partner does not clear customs itself.

---

## Phase 5 result

**Delivered:** everything in the Phase 5 plan. 116 API tests (10 new: the full shipment journey, access boundaries,
broker vs carrier customs, weight flag, customs hold and release, proof-of-delivery images and their privacy, buyer
confirmation, problem reports, the 3-day automatic confirmation, staff invitations, the public partner list, and a
check that the API documentation builds), 6 shared tests and the end-to-end browser test pass. The browser test now
runs the whole pilot: IIE adds a carrier and a St. Vincent customs broker and invites their staff, who set their
passwords from the email; the seller packs; the carrier (on a phone) schedules, collects and ships; the broker clears
customs with the commercial invoice and records EC$21.60 duties assessed; the carrier delivers with a photo and a drawn
signature; the buyer sees it all and confirms receipt.

Details: [`IIE_LOGISTICS_ARCHITECTURE.md`](IIE_LOGISTICS_ARCHITECTURE.md).

| Planned | Delivered instead | Why |
|---|---|---|
| `LogisticsProvider` interface with the portal as first adapter | Partner portal only; no provider interface yet | Partners will use the portal (decision above). An API adapter is designed in when a partner offers an API, behind the same steps |
| Shipment created when the seller confirms | Created when the seller marks the order **ready for pickup** | Partners should only see parcels that are packed |
| `customs_documents` table | Commercial invoice generated on demand from the frozen order | The order snapshot never changes, so a stored copy adds nothing yet |
| Rate cards owned by partners | Placeholder rates kept (decision above) | No partner yet |
| — | Public list of partners per country; Logistics page | Replaces the "Coming soon" pages |
| — | Delivery times accepted to the minute | Found by the browser test: minute-precision inputs could fall seconds before "ready for pickup" |

**Still open:** "Report a problem" is recorded and stops the payout and automatic confirmation, but resolving it
(refund, partial refund or release) is Phase 6. Seller payouts stay on hold until Phase 6.

---

## Phase 6 plan — Disputes, payout release and compliance

### What will be built

1. **Review period:** after delivery is confirmed, a short review window (`DISPUTE_WINDOW`) during which the buyer can
   still report a problem; when it ends the payout is approved automatically.
2. **Disputes:** a reported problem becomes a dispute case with the buyer's reason, evidence uploads (photos) from buyer
   and seller, messages, and IIE decisions: **full refund**, **partial refund**, or **reject** (release the payout).
   Refunds go through the payment provider and the ledger (reversal postings, partial where needed). Deadlines for the
   seller to respond.
3. **Payout release:** approved payouts are released through the payment provider (sandbox until contracted) or, for the
   pilot, recorded as paid by bank transfer with a reference; ledger postings move `seller_payable`, `iie_fee_revenue` and
   `logistics_payable` out; `COMPLETED` at the end. Payout statements for sellers.
4. **Logistics payable:** record payments to the logistics partner against `logistics_payable` (manual for the pilot).
5. **Compliance:** restricted and prohibited goods rules per country (checked at listing and checkout), seller
   verification documents (business registration, ID) reviewed by compliance officers, compliance hold and release
   screens, transaction limits by verification level.
6. **Admin tools:** dispute queue, payout queue, compliance queue; every decision audited.

### Database changes

`disputes`, `dispute_messages`, `dispute_evidence`, `payout_batches` (or per-payout release records),
`partner_settlements`, `restricted_product_rules`, `kyc_documents`, `compliance_checks`; payouts gain release details.

### API changes

Buyer/seller: `GET/POST /me/disputes/{iieId}` (messages, evidence) · admin: dispute decisions, payout approval and
release, compliance reviews and holds · seller: payout history.

### Risks

| Risk | Mitigation |
|---|---|
| Refund or payout sent twice | Idempotency keys per refund/payout; ledger balances enforced by the database |
| Evidence contains personal data | Private media, visible to the parties and IIE only; retention period |
| Regulatory: IIE deciding who gets held funds | Decisions are instructions to the licensed provider under its terms; legal review before launch |
| Prohibited goods listed | Rules checked at listing and checkout; compliance review queue |

### Decisions requested before Phase 6 (answered 2026-09-26, see below)

- **Review period:** how long after delivery is confirmed before the seller is paid (suggested: **7 days**)?
- **Returns:** when a buyer is refunded, must they return the goods, and who pays return shipping?
- **Partial refunds:** may IIE decide partial refunds (e.g. one pack missing), or full refunds only for the pilot?
- **Seller payouts in the pilot:** paid by IIE's payment provider when contracted, or recorded bank transfers until then?
- **Restricted goods:** the list of prohibited or licensed products for St. Lucia and St. Vincent (e.g. medicines,
  alcohol, agricultural products) — or should the pilot stay limited to baby products?
- **Seller verification:** which documents are required (business registration certificate, ID, proof of address)?

### Decisions (2026-09-26)

- **Review period:** the seller is paid **7 days after delivery is confirmed**.
- **Returns:** when a buyer is refunded, whether the goods must be returned is decided **case by case by the
  administrator**.
- **Partial refunds:** **yes**, IIE can give partial refunds.
- **Tariffs:** IIE provides the **Harmonized commodity descriptions and duties for CARICOM participating countries**; the
  platform shows them to buyers and sellers for the country they are trading into.
- **Seller verification:** sellers must provide **proof of business registration or a national ID**.
- Not yet answered: how sellers are paid before a payment provider is contracted (built: payouts through the sandbox
  provider, clearly labelled); the restricted-goods list (built: restrictions carried by the tariff file).

---

## Phase 6 result

**Delivered:** payout release after the 7-day review period, disputes with evidence and IIE decisions (full refund,
partial refund, release; returns case by case), seller verification documents, and the HS tariff engine.
131 API tests (15 new, including 6 tariff-parser unit tests: payout release, three dispute outcomes, tariff imports in
CSV and Excel, lookups, product page and checkout pricing from a schedule, prohibited goods; the seller review test now
covers document privacy and the approval gate), 6 shared tests and the end-to-end browser test pass. The browser test now also has the seller upload a
certificate of registration that IIE accepts before approval, IIE import and activate a (test) tariff file that the
seller and buyer then see, and — after delivery — the buyer report a missing pack, the seller answer, IIE decide a
EC$45.00 partial refund and the seller receive the remaining EC$45.00.

Details: [`IIE_PAYMENT_ARCHITECTURE.md`](IIE_PAYMENT_ARCHITECTURE.md) (payouts, disputes, refunds),
[`IIE_TARIFFS.md`](IIE_TARIFFS.md) (HS codes and duties), [`IIE_SECURITY.md`](IIE_SECURITY.md) (verification documents).

| Planned | Delivered instead | Why |
|---|---|---|
| Restricted-goods rules table | Restrictions come from the tariff file (prohibited / licence required per HS line); prohibited goods cannot be bought | No list was provided; the tariff schedule is the authoritative source |
| KYC document types, compliance queue | Proof of business registration or national ID, reviewed with the seller application | The decision covers sellers; buyer verification levels stay as in Phase 3 |
| Payout batches, partner settlements | Per-transaction payouts through the provider; fee and shipping stay in `provider_held` | Settlement with the provider and the logistics partner is Phase 7 |
| Evidence as a separate table | Messages carry optional photo evidence | One conversation per dispute is simpler for everyone |
| — | Countries of origin outside CARICOM (US, CA, GB, CN…) | Needed to apply the general (CET) duty to goods made outside CARICOM |

**Still open:**

- **IIE's HS file** has not been received yet. It is imported at *Admin → Tariffs* (see
  [`IIE_TARIFFS.md`](IIE_TARIFFS.md#loading-iies-hs-file)).
- **Shipping on full refunds:** who bears the carrier's charge after a full refund of a delivered order.

---

## Phase 7 plan — Administration, analytics and settlement

### What will be built

1. **Settlement:** record IIE fee collection and payments to logistics partners against the ledger
   (`iie_fee_revenue`, `logistics_payable`), with statements per partner and per period; reconciliation with the
   provider's reports.
2. **Dashboards:** for IIE (orders, GMV, fees, disputes, delivery times, payouts, per country and lane), for sellers
   (sales, payouts, ratings) and for partners (shipments, on-time rate).
3. **Reviews and ratings:** buyers rate completed orders; seller storefronts show ratings (replaces "New seller on IIE").
4. **Messaging:** buyer–seller questions on products and orders, moderated.
5. **Help Center:** articles for buyers, sellers and partners (replaces "Coming soon").
6. **Business Solutions:** business buyer accounts (invoices, purchase order numbers) and bulk listing for sellers.
7. **Admin tools:** exports (CSV) for transactions, payouts, disputes; user impersonation for support (audited, read-only).

### Decisions requested before Phase 7 (answered 2026-09-27, see below)

- **Reports:** which figures IIE's directors want to see first, and how often (daily/weekly email?).
- **Reviews:** may buyers leave written reviews, or ratings only? Does IIE moderate before publishing?
- **Messaging:** should buyers and sellers message each other directly, or only through IIE?
- **Help Center:** who writes the content (IIE staff, or drafts from us for approval)?
- **Fee and shipping settlement:** how the provider pays IIE its fee, and how IIE pays the logistics partner (per order,
  weekly, monthly).

### Decisions (2026-09-27)

| Question | Decision |
|---|---|
| Shipping on a full refund of a delivered order | The carrier is still owed. IIE chooses per case: the **seller** pays (kept back from their next payouts) or **IIE** pays |
| Reports | A **weekly email** to IIE's directors first |
| Reviews | Ratings **and** written reviews; **IIE approves** each one before it is published |
| Messaging | Buyers and sellers communicate **only through IIE** |
| Help Center | Written by IIE staff, starting from drafts we prepare |
| Settlement | The payment provider pays IIE its share **net 30 days**; IIE pays the logistics partner **net 45 days** |
| HS file | To import IIE's file covering all goods, including restricted goods; otherwise the CARICOM HS page |

## Phase 7 result

**Delivered:**

1. **Shipping on full refunds.** When IIE decides a full refund after delivery it must choose who pays the carrier. IIE's
   share is booked as an expense; a seller's share becomes a *seller charge*, kept back (oldest first) from the seller's
   next payouts and shown on their Payouts page.
2. **Settlements.** Each delivery creates what IIE owes the logistics partner (due 45 days after delivery); each seller
   payout creates what the provider owes IIE — everything it still holds for the order: fee, shipping and anything
   kept back (due 30 days after the payout). *Admin → Settlements* lists what is due and overdue; recording a
   payment with its bank or provider reference posts it to the ledger. See [`IIE_PAYMENT_ARCHITECTURE.md`](IIE_PAYMENT_ARCHITECTURE.md#settlements-phase-7).
3. **Directors' weekly email.** Every Monday at 08:00 St. Vincent time, for the week just ended: orders, money per
   currency (gross sales, IIE fees, refunds, seller payouts), what is owed between IIE and its partners, disputes,
   growth, what is waiting on IIE, and trade lanes. *Admin → Reports* previews any week, sends on demand, manages
   recipients and keeps a history. Sent once per week however many workers run.
4. **Reviews.** Buyers rate an order (1–5, optional title and text) once delivery is confirmed. Nothing is public until
   IIE publishes it (*Admin → Reviews*); a declined review tells the buyer why. Product pages and storefronts show the
   average, count and reviews (first name, initial and country).
5. **Messaging only through IIE.** In a dispute, buyer and seller each write to IIE and see only what is addressed to
   them; IIE chooses the audience of each message and can pass on a party's message and photo. For everything else,
   *Messages* is a conversation with IIE (*Admin → Messages* for staff). Messages cannot be edited or deleted.
6. **Help Center.** Public `/help` with search and topics; *Admin → Help Center* to write, preview, publish and
   unpublish. 15 draft articles (buyers, sellers, partners, everyone) are seeded **as drafts** for IIE to check; points
   needing a business answer are marked "[IIE to confirm]".

**Tests:** 141 API tests (10 new: shipping bearer, recovery from payouts, remittance and partner settlements,
IIE-routed dispute messages and evidence sharing, support conversations, reviews and moderation, Help Center, weekly
report timing and idempotency), 6 shared tests, and the end-to-end browser test, which now also covers the routed dispute
conversation, recording the provider's remittance, a review from submission to the product page, a support
conversation, publishing a Help article, and sending the weekly report.

| Planned | Delivered instead | Why |
|---|---|---|
| Dashboards for IIE, sellers and partners | Directors' weekly report (email and admin page) | The directors asked for a weekly email first |
| Buyer–seller messaging, moderated | All messages go to IIE; IIE relays | Decision: communication only through IIE |
| Partner statements, provider reconciliation | Settlement per transaction with due dates and references | Statements follow once a partner and provider are contracted |
| Business Solutions, CSV exports, support impersonation | Not built | No decisions yet; moved to Phase 8 |

**Still open:**

- **IIE's HS file** has not arrived (attachments do not reach this workspace) and `caricom.org` is blocked by this
  workspace's network policy, so **no official tariff data is loaded**; the platform still uses IIE's labelled
  estimates. Once the file or the site is available it is imported as a draft, checked, and activated only after IIE
  confirms.
- The Help Center drafts need IIE's review before publishing.
- Directors' email addresses need to be added under *Admin → Reports*.

---

## Phase 8 plan — Launch readiness

### What will be built

1. **Contracted providers:** the licensed payment provider's adapter (payments, refunds, payouts, webhooks) and the
   logistics partner onboarding, replacing the sandbox for production; provider reconciliation against settlements.
2. **Security review:** external penetration test; nonce-based Content-Security-Policy; error monitoring
   (Sentry/OpenTelemetry); shared rate limiting (Redis) for more than one API instance; S3-compatible storage.
3. **Operations:** production deployment in St. Vincent, backups with restore drills, uptime alerts, runbooks.
4. **Admin tools:** CSV exports (transactions, payouts, settlements, disputes); audit log scoped by country.
5. **Business Solutions** (if IIE decides the scope): business buyer accounts with invoices and PO numbers, bulk listing.
6. **Pilot launch:** the St. Lucia diaper seller and St. Vincent buyers on production, with real money only after the
   provider's and IIE's legal sign-off.

### Decisions requested before Phase 8

- **Payment provider and logistics partner:** which ones are contracted, and their sandbox credentials.
- **Launch date** and the first sellers and buyers invited.
- **Business Solutions:** build now or after the pilot?
- **Support hours** and response times to publish in the Help Center.

