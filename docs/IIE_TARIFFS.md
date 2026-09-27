# IIE Tariffs — HS Codes, Duties and Import Restrictions

**Status:** Phase 6. The tariff engine is built and tested. **No official tariff data is loaded yet:** IIE imports its
own Harmonized System (HS) file through *Admin → Tariffs*. Until a schedule is active for a country, the platform
uses IIE's duty estimate rules (*Admin → Checkout settings*) and labels them as estimates.

## What buyers and sellers see

Everything is shown **for the country the goods are going to**, and for the product's **country of origin** (CARICOM
origin usually pays a different, often zero, duty; goods made elsewhere pay the general or CET rate).

| Where | What |
|---|---|
| Seller: product form | Under the HS code field, for each country the seller ships to: the official description, duty for the chosen origin, CARICOM and other-origin duty, VAT, restrictions, and the source |
| Product page | "Import duties and taxes": the same, for each destination the product ships to |
| Checkout | Each line shows its HS description, duty % and VAT %, and whether the figures come from a tariff schedule or an IIE estimate. Duties are estimated from the schedule. Goods the destination prohibits cannot be bought (`NOT_IMPORTABLE`) |
| Order pages | The tariff line used, frozen at checkout (it does not change if the schedule changes later) |
| Commercial invoice | The official tariff description beside each line, for customs |
| `/tariffs` (public) | Look up any HS code or search descriptions, per country and origin |

Duties and taxes remain **an estimate, paid by the buyer on arrival**; customs sets the final amount (the customs
broker can record the assessed amount; see the logistics architecture).

## Importing a file

*Admin → Tariffs → Import a tariff schedule* (`config.manage`). Accepted: **CSV** or **Excel (.xlsx)**. Older `.xls` files:
save as `.xlsx` first. PDFs cannot be imported reliably: convert the table to Excel first.

The file needs a header row (anywhere in the first 30 rows; title rows above it are fine) with:

| Column | Recognised headings (case and punctuation ignored) | Required |
|---|---|---|
| HS code | `HS`, `HS Code`, `Heading`, `Subheading`, `Tariff No.`, `Tariff Heading`, `Code`, `Commodity code` | Yes |
| Description | anything containing `Description` or `Commodity`, or `Goods`, `Article`, `Item` | Yes |
| Duty rate | either **one** column such as `CET`, `CET Rate`, `Rate of Duty`, `Duty`, `Rate`, `MFN` — applied to the countries you choose — **or one column per country**, headed with the country's name, ISO code or IIE code (`St. Vincent`, `VC`, `VCT`, `SVG`, `St. Lucia`, `SLU`…) | Yes |
| CARICOM rate | containing `CARICOM`, `Regional` or `Common market` | No: when absent, CARICOM-origin goods get the rate entered on the form (0% by default, under CARICOM free circulation) |
| VAT | starting with `VAT` | No: when absent, each country's VAT from Checkout settings applies |
| Restrictions | `Prohibited`, `Licence`/`Permit`, or `Restriction` (text containing "prohibited" or "licence") | No |
| Notes | containing `Note` or `Remark` | No |

Rates may be written `20`, `20%`, `20.5 %`, `Free`, or as Excel percentage cells. Compound rates such as
"5% or $1.00/kg" keep their text and use the leading percentage for estimates. Rates that are not percentages
(e.g. letters) are kept as text and not used for estimates.

HS codes may be written with dots or spaces (`9619.00.10`, `9619 00`); 4 to 12 digits. Rows that are not HS lines
(chapter titles, blank rows, notes) are skipped and listed in the import summary, as are duplicate codes.

### Draft, check, activate

1. The import creates a **draft**: nothing changes on the site. The summary shows rows read, the columns recognised,
   lines per country, lines without a rate, and skipped rows with the reason. Open "First lines" to spot-check.
2. **Activate** replaces the current schedule of each country in the file. The previous schedule is kept as
   **retired** for the record. Orders already placed keep the tariff they were priced with.
3. A draft can be **discarded**. Every import, activation and discard is audited.

## How a lookup works

For a product's HS code and a destination:

1. The most specific line in the country's active schedule whose code the product code starts with (e.g. product
   `96190010` matches `96190010`, else `961900`, else `9619`). The description comes from the most specific line.
2. If those lines have no rate but the schedule has finer national sub-headings under the product's code (a 6-digit
   product code against an 8-digit national tariff), their rate is used; if they differ, the **highest** is shown and
   flagged "rates vary within this heading".
3. A **restriction** on a heading applies to everything under it; the strictest one found applies.
4. VAT: the line's VAT if the file gives one, otherwise the country's VAT from Checkout settings.
5. No schedule line at all: IIE's estimate rule, labelled "IIE estimate".

## Countries of origin

A product's country of origin can be any CARICOM country or one of the common origins outside CARICOM (United States,
Canada, United Kingdom, China, India, Brazil, Mexico, Colombia, Dominican Republic, Germany, France, Spain, Italy,
Netherlands, Japan). The latter are recorded for duty purposes only: no marketplace, trade lanes or sign-up. More can be
added by IIE.

## Data

| Table | Holds |
|---|---|
| `tariff_imports` | One upload: name, publisher, file name, in-force date, status (`DRAFT`, `ACTIVE`, `DISCARDED`), summary |
| `tariff_schedules` | One per country per import; exactly one `ACTIVE` per country (database-enforced) |
| `tariff_lines` | HS code, description, duty (other origin), CARICOM duty, VAT, rate text, restriction, notes. Indexed for code-prefix lookups and description search |
| `order_items` | Frozen at checkout: tariff HS code, description, duty %, VAT %, source |

## API

| Method and path | Who | Purpose |
|---|---|---|
| `GET /tariffs/lookup?country=VC&hs=9619.00&origin=LC` | Public | What applies (`result` or `null`) |
| `GET /tariffs/search?country=VC&q=diapers` | Public | Code prefix or description search (30 lines) |
| `GET /tariffs/coverage` | Public | Countries with an active schedule |
| `GET/POST /admin/tariffs/imports` | `config.manage` | List; multipart import (`file`, `name`, `source`, `effectiveFrom`, `countryCodes?`, `caricomDefaultPercent?`) |
| `GET /admin/tariffs/imports/{id}` | `config.manage` | Summary and sample lines |
| `POST /admin/tariffs/imports/{id}/activate` · `/discard` | `config.manage` | Activate or discard a draft |

## Loading IIE's HS file

When the file arrives: open *Admin → Tariffs*, give it its official name and publisher, the date it is in force, the
countries it covers (if it has a single rate column), and import it. Check the summary and first lines, then activate.
If its layout is not recognised, the error says which column is missing; the header names can be adjusted in the file
(e.g. rename "Rate %" to "Rate of Duty").

**Status (Phase 7):** the file IIE attached has not reached this workspace, and the CARICOM page IIE pointed to
(<https://caricom.org/documents/harmonized-commodity-description-and-coding-system-hs/>) is blocked by the workspace's
network policy. No official data has been loaded or typed in by hand. When either is available: import it as a draft,
check the summary (including restricted and prohibited lines), and activate it only after IIE confirms. If the CARICOM
publication is a PDF, its tables must first be converted to Excel (see *Importing a file*).
