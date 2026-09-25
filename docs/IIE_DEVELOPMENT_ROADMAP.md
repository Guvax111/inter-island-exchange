# IIE Development Roadmap

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | Audit, architecture | **Done** |
| 1 | Core foundation: repo, auth, roles, profiles, country engine, database | **Planned — awaiting approval** (below) |
| 2 | Marketplace: seller onboarding, storefronts, products, categories, search, cart | Not started |
| 3 | Orders and transaction engine: checkout, orders, state machine, notifications | Not started |
| 4 | Payments: provider abstraction, sandbox, multi-currency, refunds | Not started |
| 5 | Logistics: partners, shipments, tracking, delivery confirmation | Not started |
| 6 | Compliance and disputes | Not started |
| 7 | Administration and analytics | Not started |
| 8 | Production readiness | Not started |

Phase scope and exit criteria: [`IIE_PLATFORM_AUDIT.md` §20](./IIE_PLATFORM_AUDIT.md#20-prioritised-implementation-plan).

---

## Phase 1 plan — Core foundation

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

### Decisions requested before Phase 1 starts

- Approve the stack in the architecture doc (D3 in-house sessions, D6 Next.js), or name changes.
- Transactional email provider preference (or accept a sandbox until staging).
