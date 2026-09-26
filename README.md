# Inter-Island Exchange (IIE)

A secure digital marketplace and trade platform connecting buyers and sellers across CARICOM.

**Status:** Phases 1–5 complete (payments on a sandbox provider; logistics partner to be selected).
- **Phase 1 (core foundation):** registration, email verification, login with optional two-step verification,
  roles and permissions, onboarding, the country engine, admin tools and an append-only audit log.
- **Phase 2 (marketplace):** seller approval, storefronts, product listings with IIE review, photos, stock, search,
  cart, saved items and addresses.
- **Phase 3 (orders):** checkout with the full cost breakdown, orders with IIE transaction IDs
  (`IIE-SLU-SVG-000001`), the central transaction state machine, stock reservation, notifications.

- **Phase 4 (payments):** pay on the provider's hosted page (sandbox until a licensed provider is contracted),
  signed webhooks, double-entry ledger, seller confirmation within 48 hours with automatic refund, payouts on hold.

- **Phase 5 (logistics):** logistics partners and customs brokers configured by IIE, partner portal (tracking and customs
  steps, commercial invoice, proof of delivery with photo and signature), buyer delivery confirmation with automatic
  confirmation after 3 days.

Staging is hosted in St. Vincent and the Grenadines: see [`docs/IIE_DEPLOYMENT.md`](docs/IIE_DEPLOYMENT.md).
Phase 6 (disputes, payout release, compliance) is planned in the [roadmap](docs/IIE_DEVELOPMENT_ROADMAP.md).

**Contact:** Inter-Island Exchange, Inc. · Arnos Vale, St. Vincent and the Grenadines · info@interislandexchange.com · (347) 497-3977

## Repository layout

```
apps/api         NestJS API (/api/v1), database schema and migrations (Drizzle), outbox worker, CLIs
apps/web         Next.js website: public pages, sign-up/login, onboarding, account, partner portal, admin
packages/shared  Validation schemas, roles and permissions, statuses and money helpers used by both apps
deploy/staging   Docker Compose stack for the St. Vincent staging server (Caddy HTTPS, backups)
docs/            Audit, architecture, schema, API, payments, deployment, country engine, security, roadmap
```

## Run it locally

Requirements: Node 22, pnpm 10, Docker (or a local PostgreSQL 16).

```sh
pnpm install
docker compose up -d postgres          # creates databases iie and iie_test
cp .env.example .env                   # then set MFA_ENCRYPTION_KEY=$(openssl rand -base64 32)
set -a; . ./.env; set +a

pnpm --filter @iie/shared build
pnpm --filter @iie/api build
pnpm db:migrate
pnpm db:seed                           # currencies, countries, pilot lane, roles and permissions

# First administrator (password read from the environment, not the command line)
IIE_ADMIN_EMAIL=you@example.com IIE_ADMIN_PASSWORD='a-long-passphrase' pnpm --filter @iie/api admin:create

pnpm dev:api                           # http://localhost:4000/api/v1 (docs at /api/v1/docs)
pnpm dev:web                           # http://localhost:3000
```

Payments use the sandbox provider: "Pay" opens a test page marked **SANDBOX PAYMENT PAGE · NO REAL MONEY** where you
choose the bank's answer. Set `SANDBOX_PAYMENT_SECRET` outside local/test.

With `EMAIL_PROVIDER=sandbox`, verification and reset emails are printed in the API log; open the link
from there. To send real email through Gmail, see `.env.example` and [`docs/IIE_SECURITY.md`](docs/IIE_SECURITY.md).

## Checks

```sh
pnpm typecheck
pnpm test        # needs Postgres; resets the database named in TEST_DATABASE_URL (must end in _test)
pnpm build
pnpm e2e         # browser test of the pilot flow; needs Postgres database iie_e2e and a prior build
                 # E2E_BASE_URL=https://… E2E_EMAIL_DIR=… runs it against an already-running site instead
```

CI runs the same steps plus a migration drift check, a dependency audit and the end-to-end test
(`.github/workflows/ci.yml`).

## Documentation

| Document | Purpose |
|---|---|
| [`IIE_PLATFORM_AUDIT.md`](docs/IIE_PLATFORM_AUDIT.md) | Phase 0 audit and minimum scope for the St. Lucia → St. Vincent pilot |
| [`IIE_PLATFORM_ARCHITECTURE.md`](docs/IIE_PLATFORM_ARCHITECTURE.md) | Production architecture and open decisions |
| [`IIE_DEVELOPMENT_ROADMAP.md`](docs/IIE_DEVELOPMENT_ROADMAP.md) | Phase status, results of each phase, Phase 4 plan |
| [`IIE_TRANSACTION_STATE_MACHINE.md`](docs/IIE_TRANSACTION_STATE_MACHINE.md) | Every transaction state, who may move it, and how amounts are frozen |
| [`IIE_DATABASE_SCHEMA.md`](docs/IIE_DATABASE_SCHEMA.md) | Tables, rules and planned entities |
| [`IIE_API_DOCUMENTATION.md`](docs/IIE_API_DOCUMENTATION.md) | API conventions and endpoints ([`openapi.json`](docs/openapi.json)) |
| [`IIE_PAYMENT_ARCHITECTURE.md`](docs/IIE_PAYMENT_ARCHITECTURE.md) | Payment provider abstraction, sandbox, webhooks, ledger, refunds, payouts |
| [`IIE_LOGISTICS_ARCHITECTURE.md`](docs/IIE_LOGISTICS_ARCHITECTURE.md) | Partners, customs brokers, shipments, proof of delivery, delivery confirmation |
| [`IIE_DEPLOYMENT.md`](docs/IIE_DEPLOYMENT.md) | Staging server in St. Vincent: install, backups, restore, security checklist |
| [`IIE_COUNTRY_ENGINE.md`](docs/IIE_COUNTRY_ENGINE.md) | How countries, currencies and trade lanes are configured |
| [`IIE_SECURITY.md`](docs/IIE_SECURITY.md) | Security controls, secrets, Gmail limits, known gaps |
| [`MOCK_FUNCTIONALITY_AUDIT.md`](docs/MOCK_FUNCTIONALITY_AUDIT.md) | Every control that is not yet functional, and how it is labelled |

Compliance and dispute documents are written in the phase that builds them.

## Important

IIE software does not hold customer funds. Buyer payments will be held and released by a licensed
payment, banking or escrow provider; IIE records and orchestrates those holds as a "Transaction Safeguard".
