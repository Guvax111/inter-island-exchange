# IIE Development Roadmap

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | Audit, architecture | **Done** |
| 1 | Core foundation: repo, auth, roles, profiles, country engine, database | **Done** (see Phase 1 result below) |
| 2 | Marketplace: seller approval, storefronts, products, categories, search, cart | **Done** (see Phase 2 result below) |
| 3 | Orders and transaction engine: checkout, orders, state machine, notifications | **Done** (see Phase 3 result below) |
| 4 | Payments: provider abstraction, sandbox, multi-currency, refunds | **Planned — awaiting approval** (below) |
| 5 | Logistics: partners, shipments, tracking, delivery confirmation | Not started |
| 6 | Compliance and disputes | Not started |
| 7 | Administration and analytics | Not started |
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

### Decisions requested before Phase 4

- **Payment partner (D2):** which licensed provider(s) IIE will use for St. Lucia and St. Vincent (card and/or bank
  transfer), or confirm building against the sandbox until one is contracted.
- **Duties:** keep them as an estimate paid on arrival (current behaviour), or should IIE collect estimated duties at
  checkout through its customs broker?
- **Seller confirmation time:** how long a seller has to confirm a paid order before it is refunded automatically
  (suggested: 48 hours).
