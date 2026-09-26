# Inter-Island Exchange (IIE)

A secure digital marketplace and trade platform connecting buyers and sellers across CARICOM.

**Status:** Phase 1 (core foundation) complete: registration, email verification, login with optional
two-step verification, password reset, roles and permissions, buyer and seller onboarding, the country
engine (10 countries configured; St. Lucia and St. Vincent and the Grenadines open), admin tools and an
append-only audit log. Phase 2 (marketplace) is planned in the [roadmap](docs/IIE_DEVELOPMENT_ROADMAP.md).

## Repository layout

```
apps/api         NestJS API (/api/v1), database schema and migrations (Drizzle), outbox worker, CLIs
apps/web         Next.js website: public pages, sign-up/login, onboarding, account, admin
packages/shared  Validation schemas, roles and permissions, statuses and money helpers used by both apps
docs/            Audit, architecture, schema, API, country engine, security, roadmap
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

With `EMAIL_PROVIDER=sandbox`, verification and reset emails are printed in the API log; open the link
from there. To send real email through Gmail, see `.env.example` and [`docs/IIE_SECURITY.md`](docs/IIE_SECURITY.md).

## Checks

```sh
pnpm typecheck
pnpm test        # needs Postgres; resets the database named in TEST_DATABASE_URL (must end in _test)
pnpm build
```

CI runs the same steps plus a migration drift check and a dependency audit (`.github/workflows/ci.yml`).

## Documentation

| Document | Purpose |
|---|---|
| [`IIE_PLATFORM_AUDIT.md`](docs/IIE_PLATFORM_AUDIT.md) | Phase 0 audit and minimum scope for the St. Lucia → St. Vincent pilot |
| [`IIE_PLATFORM_ARCHITECTURE.md`](docs/IIE_PLATFORM_ARCHITECTURE.md) | Production architecture and open decisions |
| [`IIE_DEVELOPMENT_ROADMAP.md`](docs/IIE_DEVELOPMENT_ROADMAP.md) | Phase status, Phase 1 result, Phase 2 plan |
| [`IIE_DATABASE_SCHEMA.md`](docs/IIE_DATABASE_SCHEMA.md) | Tables, rules and planned entities |
| [`IIE_API_DOCUMENTATION.md`](docs/IIE_API_DOCUMENTATION.md) | API conventions and endpoints ([`openapi.json`](docs/openapi.json)) |
| [`IIE_COUNTRY_ENGINE.md`](docs/IIE_COUNTRY_ENGINE.md) | How countries, currencies and trade lanes are configured |
| [`IIE_SECURITY.md`](docs/IIE_SECURITY.md) | Security controls, secrets, Gmail limits, known gaps |
| [`MOCK_FUNCTIONALITY_AUDIT.md`](docs/MOCK_FUNCTIONALITY_AUDIT.md) | Every control that is not yet functional, and how it is labelled |

State machine, payment, logistics and compliance documents are written in the phases that build them.

## Important

IIE software does not hold customer funds. Buyer payments will be held and released by a licensed
payment, banking or escrow provider; IIE records and orchestrates those holds as a "Transaction Safeguard".
