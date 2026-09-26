# IIE Development Roadmap

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | Audit, architecture | **Done** |
| 1 | Core foundation: repo, auth, roles, profiles, country engine, database | **Done** (see Phase 1 result below) |
| 2 | Marketplace: seller approval, storefronts, products, categories, search, cart | **Planned — awaiting approval** (below) |
| 3 | Orders and transaction engine: checkout, orders, state machine, notifications | Not started |
| 4 | Payments: provider abstraction, sandbox, multi-currency, refunds | Not started |
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

## Phase 2 plan — Marketplace

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
