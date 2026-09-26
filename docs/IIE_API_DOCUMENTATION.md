# IIE API Documentation

**Version:** v1 (base path `/api/v1`) · **Status:** Phases 1–2

The machine-readable specification is [`openapi.json`](./openapi.json), generated from the code with
`pnpm --filter @iie/api build && pnpm --filter @iie/api openapi`. In non-production environments the
API also serves interactive docs at `/api/v1/docs`. Regenerate the spec whenever endpoints change.

## Conventions

| Topic | Rule |
|---|---|
| Versioning | Breaking changes go to `/api/v2`; v1 keeps working until retired with notice |
| Format | JSON in and out; image uploads are `multipart/form-data` with a `file` field. Money in responses is `{ amountMinor: "4500", currency: "XCD", formatted: "EC$45.00" }`; sellers send prices as decimal strings (`"45.00"`) |
| Authentication | httpOnly `iie_session` cookie set by `POST /auth/login`. The browser reaches the API through the web app's same-origin `/api/v1` proxy |
| CSRF | Every state-changing request made with a session must send `X-CSRF-Token` equal to the `iie_csrf` cookie (also returned by login and `GET /me`). The server compares it with the value stored on the session |
| Origin | State-changing requests with an `Origin` header outside `ALLOWED_ORIGINS` are refused |
| Authorisation | Deny by default. Each route declares required permissions; services then check ownership and country scope. Out-of-scope records return `404` |
| Validation | Bodies are validated with the zod schemas in `@iie/shared` (the same ones the web forms use). Unknown fields are dropped |
| Errors | `{ "error": { "code": "STABLE_CODE", "message": "Human text", "details"?: [{ "path", "message" }], "requestId": "…" } }` |
| Request IDs | Every response carries `x-request-id`; send your own (8–64 chars `[\w-]`) to correlate |
| Rate limits | 300 requests/min/IP overall; 10/min/IP on sign-up, sign-in, verification and password endpoints. `429 RATE_LIMITED` |
| Enumeration | Sign-up and forgot-password answer `202` whether or not the email exists |

## Endpoints (Phase 1)

Permission column: `public` = no session; otherwise the permission required (see `packages/shared/src/rbac.ts`).

### Authentication

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/auth/register` | public | `{ email, password, firstName, lastName, countryCode, accountType: BUYER\|SELLER\|BUYER_SELLER }` → `202`. Country must be open. Emails a verification link (24 h) |
| POST | `/auth/verify-email` | public | `{ token }` → `200`. Single use |
| POST | `/auth/resend-verification` | signed in | Invalidates the previous link |
| POST | `/auth/login` | public | `{ email, password, totpCode? }` → `200 { csrfToken }` + cookies. Errors: `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED` (10 failures → 15 min), `ACCOUNT_UNAVAILABLE`, `MFA_REQUIRED`, `MFA_INVALID` |
| POST | `/auth/logout` | signed in | `204` |
| POST | `/auth/password/forgot` | public | `{ email }` → `202`. Link valid 1 h |
| POST | `/auth/password/reset` | public | `{ token, password }` → signs out every session |
| POST | `/auth/password/change` | `session.manage.own` | `{ currentPassword, newPassword }` → signs out other sessions |
| GET | `/auth/sessions` | `session.manage.own` | Live sessions, `current` flags this one |
| DELETE | `/auth/sessions/{id}` | `session.manage.own` | Sign out one device |
| POST | `/auth/mfa/totp/setup` | `session.manage.own` | → `{ secret, otpauthUrl }` |
| POST | `/auth/mfa/totp/confirm` | `session.manage.own` | `{ code }` turns two-step verification on |
| POST | `/auth/mfa/totp/disable` | `session.manage.own` | `{ code }` |

### Me

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/me` | `profile.read.own` | User, roles, permissions (display only), profiles, addresses, `nextAction`, `csrfToken` |
| PATCH | `/me` | `profile.update.own` | `{ firstName?, lastName? }` |
| POST | `/me/onboarding` | `profile.update.own` | `{ buyer?, seller? }` — required per role held; one-time. Addresses must be in the registered country |
| POST | `/me/deletion-request` | `account.delete.own` | `{ password, reason? }` → `202`; processed by staff (Phase 7) |

`nextAction` values: `VERIFY_EMAIL`, `COMPLETE_ONBOARDING`, `ACCOUNT_UNDER_REVIEW`, `SELLER_UNDER_REVIEW`, `NONE`.

### Countries (public)

| Method | Path | Notes |
|---|---|---|
| GET | `/countries` | All configured countries with currency and open/closed flag |
| GET | `/countries/{slug\|ISO2}` | One country plus its open trade lanes and `info` (= `settings.public`) |
| GET | `/currencies` | Configured currencies |
| GET | `/lanes` | Open trade lanes |

### Administration

| Method | Path | Permission | Scope rules |
|---|---|---|---|
| GET | `/admin/users` | `user.read.any` | Filters `status, role, countryCode, q, page, pageSize`. Country admins see their country only |
| GET | `/admin/users/{id}` | `user.read.any` | Never returns the password hash |
| POST | `/admin/users/{id}/suspend` | `user.suspend` | `{ reason }`. Signs the user out everywhere and emails them. Not self; staff/partner accounts only by platform role managers |
| POST | `/admin/users/{id}/reactivate` | `user.suspend` | `{ reason }` |
| POST | `/admin/users/{id}/roles` | `user.roles.manage` (global) | `{ role, countryCode? }` — `country_admin` requires a country; others refuse one. Not on yourself |
| DELETE | `/admin/users/{id}/roles/{assignmentId}` | `user.roles.manage` (global) | |
| GET | `/admin/roles` | `user.read.any` | Roles and their permissions |
| GET | `/admin/audit-logs` | `audit.read` (global) | Filters `entityType, entityId, actorUserId`. Country-scoped view: Phase 7 |
| GET | `/admin/countries/{key}` | `country.manage` | Includes internal `settings` |
| POST | `/admin/countries` | `country.manage` (global) | Adds a country (closed by default) |
| PATCH | `/admin/countries/{ISO2}` | `country.manage` in that country | Opening/closing and identifiers (`marketplaceEnabled`, `iieCode`, `slug`, `currencyCode`) need global scope |
| GET/PUT | `/admin/lanes` | `country.manage` (global for PUT) | `{ origin, destination, enabled }` |

## Endpoints (Phase 2 — marketplace)

### Public marketplace

| Method | Path | Notes |
|---|---|---|
| GET | `/products` | Search. `q` (every word must match, prefix and stemmed), `category` (includes sub-categories), `seller` (store slug), `sellerCountry`, `countryOfOrigin`, `destination` (only sellers with an open lane to it), `currency`, `minPrice`/`maxPrice` (decimal), `inStock=true`, `sort` (`relevance`, `newest`, `price_asc`, `price_desc`), `page`, `pageSize` ≤ 48 |
| GET | `/products/{id}` | Public product page data. Hidden products (draft, in review, suspended, archived, seller not active) are `404` |
| GET | `/sellers?country=LC` | Active sellers |
| GET | `/sellers/{slug}` | Storefront: profile, policies, categories, destinations shipped to |
| GET | `/categories` | Active category tree |
| GET | `/media/{id}` | Image bytes. Public images are cacheable; images of products not yet public are visible only to their owner and reviewers |

### Seller (permission `product.manage.own`)

| Method | Path | Notes |
|---|---|---|
| GET | `/me/seller` | Seller profile, storefront, product counts, review notes when returned |
| PATCH | `/me/seller/profile` | Only while the application is returned for changes (`DRAFT`) |
| POST | `/me/seller/resubmit` | `DRAFT` → `UNDER_REVIEW` |
| PATCH | `/me/storefront` | `slug`, `displayName`, `description`, `shippingOrigin`, `returnPolicy`, `storePolicies`. `409 SLUG_TAKEN` |
| POST | `/me/storefront/logo` | multipart `file` |
| GET/POST | `/me/products` | List / create (draft) with at least one variant `{ sku, name, price, quantity }` |
| GET/PATCH | `/me/products/{id}` | Content edits to a live product send it back to review; weight, dimensions, prices and stock do not |
| POST | `/me/products/{id}/variants` | Add an option |
| PATCH | `/me/products/{id}/variants/{variantId}` | `{ name?, price? }` |
| PUT | `/me/products/{id}/variants/{variantId}/stock` | Stock count `{ quantity, note? }`; recorded in the stock ledger |
| POST | `/me/products/{id}/images` | multipart `file`, `altText?`; up to 8 |
| POST | `/me/products/{id}/images/{imageId}/delete` | |
| POST | `/me/products/{id}/submit` | Requires photo, HS code, weight, dimensions, description (`400 PRODUCT_INCOMPLETE` lists what is missing) |
| POST | `/me/products/{id}/archive` · `/restore` | |

### Buyer

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/me/cart` | `cart.manage.own` | Lines grouped by seller with live prices, per-line `issues` (`UNAVAILABLE`, `NOT_SHIPPABLE_TO_YOU`, `INSUFFICIENT_STOCK`), subtotals |
| POST | `/me/cart/items` | `cart.manage.own` + active account | `{ variantId, quantity }`; adds to an existing line. Errors: `INSUFFICIENT_STOCK`, `NOT_SHIPPABLE_TO_YOU`, `OWN_PRODUCT` |
| PATCH/DELETE | `/me/cart/items/{variantId}` | same | Change quantity / remove |
| DELETE | `/me/cart` | `cart.manage.own` | Empty the cart |
| GET/PUT/DELETE | `/me/saved/products[/{id}]` | `saved.manage.own` | |
| GET/PUT/DELETE | `/me/saved/sellers[/{slug}]` | `saved.manage.own` | |
| GET/POST | `/me/addresses` | `profile.read.own` / `profile.update.own` | Delivery addresses must be in the registered country |
| POST | `/me/addresses/{id}/default` · DELETE `/me/addresses/{id}` | `profile.update.own` | The default address cannot be deleted |

### Administration

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/admin/sellers?status=` | `seller.review` (country-scoped) | Review queue |
| GET | `/admin/sellers/{id}` | `seller.review` | Applicant, business details, storefront |
| POST | `/admin/sellers/{id}/review` | `seller.review` | `{ decision: APPROVE\|REJECT\|REQUEST_CHANGES, notes }` (notes required unless approving). Not on your own application |
| POST | `/admin/sellers/{id}/payout-setup` | `seller.review` | Pilot: `{ note }` records how payouts were arranged; `APPROVED` → `ACTIVE` |
| POST | `/admin/sellers/{id}/suspend` · `/reinstate` | `seller.review` | `{ reason }`; hides the store and all its products |
| GET | `/admin/products?status=` | `product.review` (country-scoped) | Review queue |
| GET | `/admin/products/{id}` | `product.review` | |
| POST | `/admin/products/{id}/review` | `product.review` | As for sellers; approval makes it public (or out of stock) |
| POST | `/admin/products/{id}/suspend` · `/reinstate` | `product.review` | `{ reason }` |
| GET/POST | `/admin/categories` | `category.manage` | `{ name, slug, parentSlug?, sortOrder? }` |
| PATCH | `/admin/categories/{slug}` | `category.manage` | `{ name?, sortOrder?, active? }` |

### Health

`GET /health` (public) → `{ status: "ok" }` after a database round trip.
