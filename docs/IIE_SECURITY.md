# IIE Security

**Status:** Phase 1 controls implemented and tested. A full review and penetration test are scheduled for Phase 8.

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
| Configuration | Validated at boot; production refuses sandbox email, insecure cookies and non-https URLs; secrets only from environment | `config/config.ts` |
| Dependencies | `pnpm audit --prod --audit-level high` in CI; TypeScript strict everywhere | `.github/workflows/ci.yml` |

## Secrets

| Secret | Where it lives | Rotation |
|---|---|---|
| `DATABASE_URL` | Platform secret manager | On staff change / suspected exposure |
| `MFA_ENCRYPTION_KEY` | Platform secret manager | Rotation needs a re-encryption job (planned); never reuse between environments |
| `SMTP_PASS` (Gmail App Password) | Platform secret manager | Revoke in Google Account → Security → App passwords |

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
| Deletion requests are recorded but processed manually | Phase 7 workflow with legal retention rules |
| No error-monitoring service wired up | Sentry/OpenTelemetry in Phase 8 (logs include request IDs meanwhile) |
