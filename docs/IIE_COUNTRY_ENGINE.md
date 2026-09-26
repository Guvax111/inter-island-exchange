# IIE Country Engine

No country is hard-coded in application logic. A country is a row in `countries`; adding one requires no
code change or deployment.

## What a country record holds

| Field | Example (St. Lucia) | Used for |
|---|---|---|
| `iso_alpha2` / `iso_alpha3` | `LC` / `LCA` | Data exchange, API lookups |
| `iie_code` | `SLU` | Transaction IDs: `IIE-SLU-SVG-000001` |
| `slug` | `stlucia` | Public page `/stlucia` |
| `name` | St. Lucia | Display |
| `currency_code` | `XCD` | Local prices and display |
| `regional_bloc` | `CARICOM` | Grouping and future expansion |
| `marketplace_enabled` | `true` | Whether people can register and trade there |
| `settings` (JSON) | `{ "public": { "tagline": "…" } }` | Configuration not yet in its own table. `settings.public` is shown on the public page; every other key is internal |

**Trade lanes** (`lanes`) say which origin → destination routes are open. Pilot: St. Lucia → St. Vincent and the Grenadines.

**Transaction limits** (`verification_limits`) will cap transactions by country and buyer verification level (enforced from Phase 3).

## Seeded configuration

| Country | ISO | IIE code | Page | Currency | Open |
|---|---|---|---|---|---|
| St. Lucia | LC | SLU | /stlucia | XCD | Yes |
| St. Vincent and the Grenadines | VC | SVG | /stvincent | XCD | Yes |
| Grenada | GD | GRD | /grenada | XCD | No |
| Barbados | BB | BRB | /barbados | BBD | No |
| Trinidad and Tobago | TT | TTO | /trinidad | TTD | No |
| Jamaica | JM | JAM | /jamaica | JMD | No |
| Guyana | GY | GUY | /guyana | GYD | No |
| Dominica | DM | DMA | /dominica | XCD | No |
| Antigua and Barbuda | AG | ATG | /antigua | XCD | No |
| St. Kitts and Nevis | KN | KNA | /stkitts | XCD | No |

`SLU` and `SVG` come from the IIE brief. Other countries use their ISO alpha-3 code until IIE picks brand
codes. **Change IIE codes before the first transaction in that country**; after that they appear in
permanent transaction IDs.

Currencies seeded: XCD, USD, TTD, BBD, JMD, GYD (all with 2 minor units).

The seed (`pnpm db:seed`) only inserts missing rows; it never overwrites a country an administrator has edited.

## Who can change what

| Change | Who |
|---|---|
| Add a country, open/close a marketplace, change IIE code, slug or currency, open/close lanes | Super administrator (global `country.manage`) |
| Edit a country's settings (e.g. public tagline, internal notes) | Super administrator, or the Country Administrator for that country |

Every change is written to the audit log with the previous and new values.

## One platform, many countries

Country pages (`/stlucia`, `/stvincent`, …) are one route (`apps/web/src/app/[country]`) that renders
whatever the country table says. All countries share the same users, products (Phase 2) and transaction
engine (Phase 3).

## Coming next

Normalised tables for tax and duty rules, customs rules, restricted products per destination, supported
payment methods and providers, ports and airports, and country partners (logistics, brokers, delivery),
replacing ad-hoc `settings` keys as each phase needs them.
