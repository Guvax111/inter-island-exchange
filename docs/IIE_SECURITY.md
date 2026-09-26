# IIE Security

**Status:** Phase 1–3 controls implemented and tested. A full review and penetration test are scheduled for Phase 8.

## Implemented in Phase 1

| Area | Control | Where / test |
|---|---|---|
| Passwords | argon2id (19 MiB, t=2, p=1); 12–128 characters; constant-time path for unknown emails | `auth/passwords.ts`; `auth.test.ts` |
| Brute force | 10 failed sign-ins → 15-minute lock; 10 req/min/IP on auth endpoints; 300 req/min/IP overall | `auth.service.ts`, `app.module.ts`; rate-limit and lockout tests |
| Sessions | Random 256-bit token in an httpOnly, SameSite=Lax, Secure (outside local) cookie; only its SHA-256 is stored; 14-day absolute and 72-hour idle expiry; revoked on logout, password change/reset, suspension; device list with remote sign-out | `session.service.ts`; session tests |
| CSRF | Per-session token required in `X-CSRF-Token` on every state-changing request, compared with the session's stored value; `Origin` allow-list | `auth.guard.ts`; CSRF and origin tests |
| Two-step verification | TOTP (RFC 6238); secrets AES-256-GCM encrypted with `MFA_ENCRYPTION_KEY` | `auth.service.ts`; MFA test |
| Authorisation | Deny-by-default global guard; permission per route; ownership and country scope in services; out-of-scope records return 404; users cannot grant themselves roles; sign-up can only yield buyer/seller | `auth.guard.ts`, `principal.ts`, `admin-users.service.ts`; `rbac.test.ts` |
| Account lifecycle | Commercial activation requires onboarding + verified email; suspended/rejected/closed accounts cannot sign in and existing sessions stop working | `account-lifecycle.service.ts`; onboarding tests |
| Enumeration | Sign-up and forgot-password give identical responses; the account owner is emailed instead | `auth.test.ts` |
| One-time links | 256-bit tokens, hashed at rest, single use, 24 h (verify) / 1 h (reset), earlier links invalidated; removed from the outbox once emailed; `Referrer-Policy: no-referrer` on the web app | `auth.service.ts`, `outbox.service.ts`, `next.config.ts` |
| Input validation | zod schemas at every API boundary, shared with the web forms; unknown fields stripped | `@iie/shared`, `ZodValidationPipe` |
| SQL injection | Parameterised queries only (Drizzle); no string-built SQL with user input | — |
| XSS | React escaping; email templates HTML-escape all values; no `dangerouslySetInnerHTML` | `email/templates.ts` |
| Headers | API: `helmet` defaults, no `x-powered-by`. Web: `nosniff`, `X-Frame-Options: DENY`, `Permissions-Policy`, no-referrer | `bootstrap.ts`, `next.config.ts` |
| Audit | Append-only `audit_logs` (DB trigger blocks UPDATE/DELETE/TRUNCATE); actor, roles, IP, user agent, session, request ID, before/after for every security and admin action | `audit.service.ts`; audit tests |
| Errors | Uniform error body with request ID; stack traces never returned | `http-exception.filter.ts` |
| Configuration | Validated at boot; production refuses sandbox email, sandbox payments, local image storage, insecure cookies and non-https URLs; secrets only from environment | `config/config.ts` |
| Dependencies | `pnpm audit --prod --audit-level high` in CI; TypeScript strict everywhere | `.github/workflows/ci.yml` |

## Added in Phase 2

| Area | Control | Where / test |
|---|---|---|
| Uploads | Type decided by decoding the file (JPEG, PNG, WebP only), never by name or declared type; size limit; decompression-bomb pixel limit; every image re-encoded to WebP, resized, EXIF/GPS metadata removed; random server-generated storage keys | `media/media.service.ts`; `products.test.ts` |
| Image privacy | Images of unpublished products and inactive stores are served only to their owner and in-scope reviewers; `Cache-Control: private, no-store` for those; `Content-Security-Policy: default-src 'none'` on image responses | `media.service.ts`; image tests |
| Marketplace visibility | One shared rule for what the public sees; suspending a seller hides the store, its products and images immediately | `catalog/visibility.ts`; seller suspension test |
| Review integrity | Reviewers cannot decide on their own seller application or products; reviews are country-scoped; every decision is audited with notes | `sellers.service.ts`, `products.service.ts`; tests |
| Stock integrity | Stock changes recorded in an append-only ledger (DB trigger) | `inventory_movements`; ledger test |
| Search | Free text is reduced to letters and digits before building the query, so it cannot inject query syntax; parameterised SQL | `marketplace/search.provider.ts`; search test |
| Cart | Server checks visibility, stock, trade lane and own-product rules on every add; cart holds quantities only, never prices | `cart.service.ts`; cart tests |

## Added in Phase 5

| Area | Control | Where / test |
|---|---|---|
| Partner access | Partner roles give permissions; **membership** of the assigned partner decides which shipments are visible or changeable. Other partners' staff get "not found" | `shipments.service.ts`; logistics tests |
| Separation of duties | The carrier cannot record customs steps (unless it clears customs); the broker cannot move or deliver the parcel | logistics tests |
| Staff onboarding | IIE-invited only (no self sign-up as a partner); 72-hour single-use set-password link that also verifies the email; removal revokes the role | `partners.service.ts`, `auth.service.ts`; invitation tests |
| Personal data | Delivery address and buyer phone go to the assigned partners only; sellers see town and country; the public partner list has names only | logistics tests |
| Proof of delivery | Images validated and re-encoded, metadata removed, private to the buyer, assigned partners and IIE staff; proof and tracking history append-only | `media.service.ts`; `0010_logistics_append_only.sql`; tests |
| Delivery time integrity | No future times; not before the parcel was ready for pickup | tests |
| Weight discrepancies | Parcels over 10% heavier than declared are flagged to IIE, never charged automatically | tests |

## Added in Phase 4

| Area | Control | Where / test |
|---|---|---|
| Card data | Buyers pay on the provider's hosted page; IIE never receives card numbers or bank credentials | `payment.provider.ts` |
| Custody of funds | IIE does not hold money: the provider holds it; IIE records instructions and ledger entries | `IIE_PAYMENT_ARCHITECTURE.md` |
| Webhooks | Signature over the raw body (HMAC-SHA256, 5-minute timestamp tolerance, constant-time compare); stored and de-duplicated before processing; only verified events change an order; session cookies ignored | `payments.service.ts`; webhook tests |
| Amount integrity | A paid amount or currency that differs from the order puts it on compliance hold instead of confirming it | mismatch test |
| Ledger | Double-entry, append-only, balance enforced by the database at commit | `0007_payments_append_only.sql`; ledger integrity test |
| Refund idempotency | The refund row ID is the provider idempotency key, so a retry cannot refund twice | `payments.service.ts` |
| Sandbox page | Only with the sandbox provider; per-payment HMAC token; marked "NO REAL MONEY"; production refuses the sandbox | `payments.controllers.ts`; token test |
| Staging | Only Caddy exposed (HTTPS, HSTS, `noindex`); API docs not published; secrets generated on the server in a `chmod 600` `.env` | `deploy/staging`, `IIE_DEPLOYMENT.md` |

## Added in Phase 3

| Area | Control | Where / test |
|---|---|---|
| Financial integrity | Every amount in integer minor units, computed server-side from frozen quotes; the browser never sends prices | `pricing.ts`, `checkout.service.ts`; pricing unit tests |
| Price freezing | Orders are created only from a 15-minute quote; later price changes do not touch placed orders | checkout test |
| Stock races | Stock checked and reserved under row locks in one database transaction; the last unit cannot be sold twice | concurrent-order test |
| State integrity | One transition function; allowed moves and actor types in a single table; version counter; append-only event log (trigger); immutable IIE ID (trigger) | `transaction-engine.ts`; engine tests |
| Order privacy | Buyers see only their orders; sellers see only their sales and only the buyer's first name and delivery town; admin access is country-scoped to origin or destination | visibility test |
| Configuration changes | Fee, shipping rates and duty estimates change only with `config.manage` (super administrators) and are audited with before/after values | settings test |

## Secrets

| Secret | Where it lives | Rotation |
|---|---|---|
| `DATABASE_URL` | Platform secret manager | On staff change / suspected exposure |
| `MFA_ENCRYPTION_KEY` | Platform secret manager | Rotation needs a re-encryption job (planned); never reuse between environments |
| `SMTP_PASS` (Gmail App Password) | Platform secret manager | Revoke in Google Account → Security → App passwords |
| `SANDBOX_PAYMENT_SECRET` | Server `.env` (staging) | Any time; open sandbox payment pages stop working |
| Payment provider API keys and webhook secret | Platform secret manager (when contracted) | Per the provider's process |

Never commit `.env` files (`.gitignore` blocks them). `.env.example` documents every key.

## Gmail as the initial email provider — limits to know

- Use a dedicated Google account for IIE with 2-Step Verification and an **App Password**.
- Consumer Gmail allows roughly **500 recipients per day** (Google Workspace roughly 2,000). Enough for the pilot, not for launch.
- Messages come from a `@gmail.com` address (or your Workspace domain), which some recipients' filters treat with suspicion.
- Plan: move to a transactional email service with SPF/DKIM/DMARC on an IIE domain before public launch. Only configuration changes; the `EmailProvider` interface already supports it.

## Known gaps (tracked for later phases)

| Gap | Plan |
|---|---|
| Rate-limit counters are per process (in memory) | Move to Redis when running more than one API instance (Phase 3) |
| No Content-Security-Policy yet | Nonce-based CSP in Phase 8 |
| `ACCOUNT_LOCKED` and `MFA_REQUIRED` reveal that an account exists or that a password was right | Accepted for usability; revisit in the Phase 8 review |
| Phone verification (SMS) not implemented | SMS provider abstraction, Phase 3 |
| Country-scoped audit reading | Phase 7 |
| Object storage adapter (S3-compatible) not built; `local` disk storage is refused in production | Build with the hosting decision (D4), before staging with real sellers |
| Image virus scanning | Images are fully decoded and re-encoded (which removes embedded payloads); add scanning when non-image documents arrive (Phase 5 customs documents) |
| Deletion requests are recorded but processed manually | Phase 7 workflow with legal retention rules |
| No error-monitoring service wired up | Sentry/OpenTelemetry in Phase 8 (logs include request IDs meanwhile) |
