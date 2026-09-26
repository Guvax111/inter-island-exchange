# IIE API Documentation

**Version:** v1 (base path `/api/v1`) · **Status:** Phase 1

The machine-readable specification is [`openapi.json`](./openapi.json), generated from the code with
`pnpm --filter @iie/api build && pnpm --filter @iie/api openapi`. In non-production environments the
API also serves interactive docs at `/api/v1/docs`. Regenerate the spec whenever endpoints change.

## Conventions

| Topic | Rule |
|---|---|
| Versioning | Breaking changes go to `/api/v2`; v1 keeps working until retired with notice |
| Format | JSON in and out. Money is always `{ amountMinor: string, currency: "XCD" }` (from Phase 2) |
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

### Health

`GET /health` (public) → `{ status: "ok" }` after a database round trip.
