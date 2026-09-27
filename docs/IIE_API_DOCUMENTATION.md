# IIE API Documentation

**Version:** v1 (base path `/api/v1`) · **Status:** Phases 1–3

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

## Endpoints (Phase 3 — checkout and transactions)

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/me/checkout/quote` | `order.create` + active account | `{ sellerSlug, addressId }` → frozen quote valid 15 min: lines, `productCost`, `shipping` (+ `isPlaceholder`), `platformFee` (`percent`, `payer`, `chargedToBuyer`), `otherFees`, `dutiesEstimate` (`duty`, `vat`, `paidWhen: ON_ARRIVAL`), `total`, `estimatedLandedTotal`. Errors: `NOTHING_TO_CHECKOUT`, `CART_HAS_ISSUES`, `SELLER_UNAVAILABLE`, `NOT_SHIPPABLE_TO_YOU`, `NO_SHIPPING_RATE`, `LIMIT_EXCEEDED`, `DESTINATION_CLOSED`, `OWN_PRODUCT` |
| POST | `/me/checkout` | `order.create` + active account | `{ quoteId }` → `201 { iieId }`. Reserves stock for 30 minutes. Errors: `QUOTE_USED`, `QUOTE_EXPIRED`, `STOCK_CHANGED` (409) |
| GET | `/me/orders` · `/me/orders/{iieId}` | `order.read.own` | Buyer's orders; detail has items, amounts, delivery address, sub-statuses, `timeline`, `paymentDueAt`, `canCancel`, `canPay`, `sellerConfirmDueAt` |
| POST | `/me/orders/{iieId}/cancel` | `order.create` | `{ reason? }` while `AWAITING_PAYMENT` or `PAYMENT_FAILED` |
| GET | `/me/sales` · `/me/sales/{iieId}` | `order.fulfil.own` | Seller's orders; buyer first name and delivery town only; includes `sellerPayout` |
| GET | `/me/notifications` | signed in | `{ items, unread }` |
| POST | `/me/notifications/read` | signed in | `{ ids? }` (all when empty) |
| GET | `/admin/transactions` · `/admin/transactions/{iieId}` | `transaction.read.any` (country-scoped: origin or destination) | Filters `status`, `q` (IIE ID); detail includes the event log with actors |
| GET/POST/PATCH | `/admin/shipping-rates[/{id}]` | `config.manage` | `{ origin, destination, serviceName, maxWeightGrams, price, isPlaceholder, active }` |
| GET/PUT | `/admin/fee-rule` | `config.manage` | `{ percent, defaultPayer }` |
| GET/POST/PATCH | `/admin/duty-estimates[/{id}]` | `config.manage` | `{ destination, hsPrefix, caricomOriginDutyPercent, otherOriginDutyPercent, vatPercent, notes, isPlaceholder }` |

Sellers set who pays the fee with `PATCH /me/storefront { feePayer: "BUYER" | "SELLER" | null }` (null = IIE default).

## Endpoints (Phase 4 — payments)

Design: [`IIE_PAYMENT_ARCHITECTURE.md`](IIE_PAYMENT_ARCHITECTURE.md).

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/me/orders/{iieId}/pay` | `order.create` + active account | → `{ redirectUrl }` (the provider's hosted page). Reuses an open attempt. Errors: `NOT_PAYABLE`, `PAYMENT_WINDOW_CLOSED` |
| POST | `/me/sales/{iieId}/confirm` | `order.fulfil.own` | `204`. Only while `AWAITING_SELLER_CONFIRMATION` |
| POST | `/me/sales/{iieId}/decline` | `order.fulfil.own` | `{ reason }` (3–500 chars, shown to the buyer) → `204`; full refund |
| POST | `/webhooks/payments/{provider}` | Public; provider signature over the raw body | → `{ received, duplicate, result }`. Invalid signature `400`. Session cookies are ignored |
| GET/POST | `/sandbox-pay/{id}` | Public; signed page token | Sandbox hosted page (only with `PAYMENT_PROVIDER=sandbox`); the POST redirects `303` to `/orders/{iieId}?payment=…` |
| GET | `/admin/transactions/{iieId}/money` | `transaction.read.any` (country-scoped) | `{ balanced, balances, ledger, payments, refunds, events }` |
| GET | `/admin/payouts` | `payout.approve` | `?status=ON_HOLD\|CANCELLED` |
| GET/POST | `/admin/exchange-rates` | `config.manage` | `{ base, quote, rate, source }`; append-only. Error `SAME_CURRENCY` |

## Endpoints (Phase 5 — logistics)

Design and the full list: [`IIE_LOGISTICS_ARCHITECTURE.md`](IIE_LOGISTICS_ARCHITECTURE.md#api).

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/me/sales/{iieId}/ready` | `order.fulfil.own` | `{ parcelWeightGrams?, pickupNotes? }` → `201 { shipmentId, assigned }`. Only `SELLER_CONFIRMED` |
| POST | `/me/orders/{iieId}/confirm-delivery` | `order.read.own` | `204`. Only `DELIVERED` |
| POST | `/me/orders/{iieId}/report-problem` | `dispute.create.own` | `{ reason }` → `204` |
| GET | `/partner/shipments` · `/partner/shipments/{iieId}` | `shipment.read.assigned` + membership | Others' shipments are "not found" |
| GET | `/partner/shipments/{iieId}/commercial-invoice` | `shipment.read.assigned` + membership | Customs document data |
| POST | `/partner/shipments/{iieId}/steps` | carrier: `shipment.update.assigned`; customs: `customs.document.manage` | `{ step, … }`; dates are ISO 8601 strings. Errors: `INVALID_TRANSITION`, `VALIDATION_FAILED`, `403` for the wrong party |
| POST | `/partner/shipments/{iieId}/delivery` | `shipment.update.assigned` (carrier) | Multipart `recipientName`, `deliveredAt`, `note?`, `photo?`, `signature?`. Errors: `DELIVERY_IN_FUTURE`, `DELIVERY_BEFORE_PICKUP` |
| GET | `/countries/{code}/partners` | Public | `{ logisticsPartners, customsBrokers }` (names only) |
| GET/POST/PATCH | `/admin/partners[/{id}]` | `partner.manage` | Errors: `UNKNOWN_COUNTRY` |
| POST/DELETE | `/admin/partners/{id}/lanes[/{laneId}]` | `partner.manage` | `{ origin, destination }`. Errors: `NOT_A_CARRIER`, `UNKNOWN_LANE` |
| POST/DELETE | `/admin/partners/{id}/members[/{userId}]` | `partner.manage` | `{ email, firstName, lastName }` → `{ userId, newAccount }`. Errors: `ALREADY_A_MEMBER` |
| GET | `/admin/shipments` | `transaction.read.any` (country-scoped) | `?view=attention\|all`; `issues[]` |
| PATCH | `/admin/shipments/{iieId}` | `partner.manage` | `{ logisticsPartnerId?, customsBrokerId? }`. Errors: `INVALID_PARTNER`, `WRONG_COUNTRY` |

Order detail (`/me/orders/{iieId}`, `/me/sales/{iieId}`, `/admin/transactions/{iieId}`) adds `canMarkReady`,
`canConfirmDelivery`, `deliveryConfirmDueAt` and `shipment` (partners, events, customs, weights except for buyers, proof
of delivery; image links for buyers and staff only).

## Endpoints (Phase 6 — payouts, disputes, verification, tariffs)

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/me/orders/{iieId}/report-problem` | `dispute.create.own` | `{ reason }` (10–1000). From `DELIVERED` or during the 7-day review (`DISPUTE_WINDOW`); else `409` |
| GET | `/disputes/{iieId}` | Buyer, seller, or IIE staff for either country | Conversation, decision; `limits` for IIE only |
| POST | `/disputes/{iieId}/messages` | Same | Multipart `body`, optional `photo`. `409 DISPUTE_CLOSED` after the decision |
| GET | `/admin/disputes?status=OPEN\|ALL` | `transaction.read.any` (country-scoped) | Queue |
| POST | `/admin/disputes/{iieId}/decision` | `dispute.resolve` | `{ decision: FULL_REFUND\|PARTIAL_REFUND\|RELEASE_TO_SELLER, refundAmount?, returnRequired, returnInstructions?, note }`. Errors: `REFUND_TOO_LARGE`, `DISPUTE_CLOSED` |
| GET | `/me/payouts` | `payout.read.own` | Seller's payouts with due and paid dates |
| POST | `/admin/payouts/{iieId}/retry` | `payout.approve` | Retry a failed payout |
| GET/POST | `/me/seller/documents` | `product.manage.own` | Multipart `type` (`BUSINESS_REGISTRATION`, `NATIONAL_ID`), `file` (PDF/JPEG/PNG/WebP, ≤ 10 MB) |
| GET | `/seller-documents/{id}` | The seller, or `seller.review` in the seller's country | Always an attachment |
| POST | `/admin/seller-documents/{id}/review` | `seller.review` | `{ decision: ACCEPT\|REJECT, note? }`. Seller approval requires an accepted document (`DOCUMENT_REQUIRED`) |
| GET | `/tariffs/lookup` · `/tariffs/search` · `/tariffs/coverage` | Public | See [`IIE_TARIFFS.md`](IIE_TARIFFS.md#api) |
| GET/POST | `/admin/tariffs/imports[/{id}]`, `…/activate`, `…/discard` | `config.manage` | Tariff imports |
| GET | `/countries?scope=origins` | Public | Adds countries used only as a country of origin |

Public product detail adds `importInfo[]` (per destination: tariff resolution). Checkout quote lines and order items add
`tariff`. Order detail adds `canReportProblem`, `reviewEndsAt`, `dispute`, and for sellers/IIE `payout`. Checkout error
`NOT_IMPORTABLE` for goods the destination prohibits.

## Endpoints (Phase 7 — settlement, reviews, messaging, help, reports)

| Method and path | Who | Purpose |
|---|---|---|
| `POST /admin/disputes/{iieId}/decision` | `dispute.resolve` | Now requires `shippingBorneBy` (`SELLER` or `IIE`) for a full refund |
| `POST /disputes/{iieId}/messages` | Parties, IIE | Buyer and seller messages go to IIE only; IIE may set `audience` (`BUYER`, `SELLER`, `BOTH`) |
| `POST /admin/disputes/{iieId}/messages/{messageId}/share` | `dispute.resolve` | Pass a party's message and photo to the other side |
| `GET /admin/settlements` · `POST /admin/settlements/{id}/paid` | `payout.approve` | Settlements (see payment architecture) |
| `POST /me/orders/{iieId}/review` `{rating, title?, body?}` | Buyer | Review a delivered order (once); pending until IIE approves |
| `GET /admin/reviews?status=` · `POST /admin/reviews/{id}/moderate` `{decision, note?}` | `review.moderate` | Moderation queue; a rejection needs a reason |
| `GET/POST /me/messages` · `GET /me/messages/{id}` · `POST /me/messages/{id}/messages` | Signed-in user | Conversations with IIE (`iieId` optional, must be the user's order) |
| `GET /admin/support?status=&waiting=` · `GET /admin/support/{id}` · `POST …/messages` · `…/close` · `…/reopen` | `support.respond` | IIE's inbox, scoped to the staff member's countries |
| `GET /help?audience=&q=` · `GET /help/{slug}` | Public | Published articles; full-text search |
| `GET/POST /admin/help` · `GET/PATCH /admin/help/{id}` · `POST …/publish` · `…/unpublish` | `content.manage` | Help Center editing |
| `GET /admin/reports/weekly?weekOf=` · `POST /admin/reports/weekly/send` · `GET /admin/reports/runs` · `GET /admin/reports/recipients` | `report.read` | Directors' report |
| `POST /admin/reports/recipients` · `POST /admin/reports/recipients/{id}/enable|disable` | `config.manage` | Recipients |

Product pages (`GET /products/{id}`) add `rating` and `reviews`, and the seller's `rating`; storefronts
(`GET /sellers/{slug}`) add `rating`, `reviews` and `completedTransactions`. Order views add `review` and `canReview`.

### Health

`GET /health` (public) → `{ status: "ok" }` after a database round trip.
