# IIE Platform Audit

> **Decision recorded (2026-09-25):** IIE is built greenfield in this dedicated repository,
> `Guvax111/inter-island-exchange` (option 2 below). The audit was carried out on
> `Guvax111/lockeys-oasis-website`, which remains the Lockey's Oasis coaching site. Links to
> `MOCK_FUNCTIONALITY_AUDIT.md` in sections 8 and 18 refer to that repository's copy; this
> repository's copy tracks IIE controls.

**Project:** Inter-Island Exchange, Inc. (IIE)
**Repository audited:** `Guvax111/lockeys-oasis-website` (branch `main`, commit `e74b228`)
**Audit date:** 2026-09-25
**Phase:** 0 — Audit existing codebase

---

## 0. Executive summary — read this first

**This repository does not contain an Inter-Island Exchange website or marketplace.**

It holds a single-page marketing site for **"Lockey's Oasis — Life Coaching"**, generated with
[Lovable](https://lovable.dev) from the `vite_react_shadcn_ts` template. The full git history is
7 commits: the template, then the coaching site, a background colour tweak, a contact form, and a
book section. No branch, file, or commit mentions IIE, CARICOM, products, sellers, buyers, orders,
payments, or countries. This is the only repository the session can reach.

Consequences:

| The brief assumes | What exists |
|---|---|
| An IIE website and marketplace to build on | A 1-page coaching brochure site |
| Existing database and data models | None. No database, no backend, no ORM, no migrations |
| Existing authentication | None |
| Buyer / seller / product features | None |
| Existing APIs and integrations | One client-side EmailJS call with placeholder credentials |
| Payments, countries, currency, logistics, admin | None |

So **IIE is a greenfield build.** Nothing in this repo is IIE business logic, so there is no
IIE functionality at risk of being destroyed. The only reusable asset is the frontend toolkit
(React, TypeScript, Tailwind CSS, shadcn/ui, Radix, react-hook-form, zod, TanStack Query).

**Decision needed before Phase 1** (see §21): where IIE should live.

1. The real IIE code exists elsewhere (another GitHub repo, or a Lovable project that is not
   synced to GitHub). Then that repo needs to be connected to this session and audited instead.
2. Build IIE greenfield in a **new, dedicated repository** (recommended if there is no other code).
3. Build IIE in **this** repository, replacing the coaching site. This deletes a live-looking
   business website belonging to "Lockey's Oasis", so it should be an explicit owner decision.

The architecture in [`IIE_PLATFORM_ARCHITECTURE.md`](./IIE_PLATFORM_ARCHITECTURE.md) applies
unchanged to options 2 and 3.

---

## 1. Technology stack

| Layer | Technology | Version (package.json) | Notes |
|---|---|---|---|
| Build tool | Vite + `@vitejs/plugin-react-swc` | ^5.4.1 | Dev server on port 8080 |
| Language | TypeScript | ^5.5.3 | **`strict: false`, `noImplicitAny: false`, `strictNullChecks: false`** |
| UI framework | React | ^18.3.1 | Client-side SPA only; no SSR |
| Routing | react-router-dom | ^6.26.2 | Two routes: `/` and `*` (404) |
| Styling | Tailwind CSS + `tailwindcss-animate` + custom `sage`/`terracotta`/`sky` palettes | ^3.4.11 | |
| Component library | shadcn/ui (49 components in `src/components/ui/`) on Radix UI | — | Only 7 are used |
| Forms / validation | react-hook-form, zod, `@hookform/resolvers` | installed | **Not used** by any app code |
| Data fetching | TanStack Query | ^5.56.2 | `QueryClientProvider` mounted, **no queries** |
| Email | `@emailjs/browser` | ^4.4.1 | Client-side send, placeholder credentials |
| Dev tooling | ESLint 9, `lovable-tagger` | — | |
| Backend | **None** | | |
| Database | **None** | | |
| Tests | **None** (no test runner installed) | | |
| CI/CD | **None** in repo (Lovable "Publish" is the deploy path per README) | | |

Build status at audit time: `npm run build` **passes** (344 kB JS / 106 kB gzip).
`npm run lint` **fails**: 3 errors, 7 warnings (empty-interface errors in shadcn `command.tsx`
and `textarea.tsx`, `require()` in `tailwind.config.ts`).

## 2. Application architecture

```
index.html ─ main.tsx ─ App.tsx (QueryClient, Tooltip, Toasters, BrowserRouter)
                           ├─ "/"  → pages/Index.tsx
                           │          Header · Hero · About · Services · Book · Testimonials · Contact · Footer
                           └─ "*"  → pages/NotFound.tsx
```

All content is hard-coded JSX. Navigation is in-page smooth scrolling to section IDs.
There is no state beyond local component state, no API layer, no environment configuration
(`import.meta.env` is never read), and no `.env` file.

## 3. Database structure

None. No database, schema, ORM, migrations, seed data, or data-access layer.

## 4. Authentication / authorization

None. No login, sessions, users, roles, or route guards.

## 5. Buyer functionality — None.
## 6. Seller functionality — None.
## 7. Product and marketplace functionality — None.

The nearest analogues are three hard-coded coaching "packages" in `Services.tsx` ($125 / $450 /
$850) whose buttons scroll to the contact form. They are not products in any data sense.

## 8. Mock and placeholder links/buttons

Full itemised table in [`MOCK_FUNCTIONALITY_AUDIT.md`](./MOCK_FUNCTIONALITY_AUDIT.md). Headline
issue:

- **`Contact.tsx` booking form is non-functional but reports success.** It calls
  `emailjs.send('YOUR_SERVICE_ID', 'YOUR_TEMPLATE_ID', …, 'YOUR_PUBLIC_KEY')`. This always fails,
  and the `catch` block shows a *"Request Sent … has been received"* toast and clears the form.
  Every enquiry submitted on this site is silently lost. This matters today for Lockey's Oasis
  regardless of the IIE decision.

## 9. Static vs functional pages

| Route | Type | Functional elements |
|---|---|---|
| `/` | Static single page | Scroll nav, mobile menu toggle, external Amazon link, broken contact form |
| `*` | Static 404 | Link home |

## 10. Existing APIs and integrations

| Integration | Where | Status |
|---|---|---|
| EmailJS | `src/components/Contact.tsx` | Placeholder credentials; always fails |
| Amazon product link | `src/components/Book.tsx` | Works (external link, long tracking querystring) |
| Google Fonts (Inter) | `index.html` | Works |
| Lovable OG image / `@lovable_dev` Twitter handle | `index.html` | Template leftovers |

## 11. Payment functionality — None.
## 12. Country / multi-currency functionality — None. (Prices are hard-coded USD strings.)
## 13. Logistics functionality — None.
## 14. Administrative functionality — None.

## 15. Security concerns

| # | Severity | Finding | Location |
|---|---|---|---|
| S1 | High (integrity) | Form failure is reported to the user as success; data silently lost | `Contact.tsx` `catch` block |
| S2 | Medium | Recipient email and form payload logged to browser console (`console.log('Sending booking request:', …)`) | `Contact.tsx` |
| S3 | Medium | Email-sending pattern is client-side: when real EmailJS keys are added they ship in the JS bundle and the endpoint can be abused for spam unless EmailJS domain/rate restrictions are configured | `Contact.tsx` |
| S4 | Medium | `npm audit --omit=dev`: 5 vulnerabilities (4 high, 1 moderate) incl. `@remix-run/router` (via react-router), `lodash`, `@babel/runtime`. All have fixes via `npm audit fix` | `package-lock.json` |
| S5 | Low | Personal phone number and email hard-coded in source (in public repo history if ever made public) | `Header`, `Footer`, `Contact` |
| S6 | Low | TypeScript strictness disabled — unacceptable for financial code | `tsconfig*.json` |
| S7 | Low | No security headers / CSP (depends on host; none configured) | — |

None of these are IIE vulnerabilities (there is no IIE code), but S1, S4 and S6 are the patterns
the IIE build must not inherit.

## 16. Technical debt

- TypeScript strict mode off; lint failing.
- 42 of 49 shadcn components unused (dead weight, but tree-shaken from the bundle).
- `src/App.css` is Vite-template CSS that is never imported.
- `react-hook-form` / `zod` / TanStack Query installed but unused.
- Duplicated nav markup (desktop/mobile/footer) and duplicated `scrollToSection` helpers.
- Mixed lockfiles (`package-lock.json` and `bun.lockb`).
- No tests, no CI, no environment configuration.
- Generic Lovable README and OG/Twitter metadata.

## 17. Missing database relationships

Not applicable — there is no database. The complete required model is specified in
[`IIE_PLATFORM_ARCHITECTURE.md` §7](./IIE_PLATFORM_ARCHITECTURE.md#7-data-model-core-entities).

## 18. Reuse / refactor / remove

| Item | Verdict for IIE | Reason |
|---|---|---|
| `src/components/ui/*` (shadcn/Radix) | **Reuse** | Accessible, mobile-friendly primitives; good base for the IIE design system |
| `tailwind.config.ts`, `components.json`, `lib/utils.ts` (`cn`) | **Reuse** (retheme) | Replace the sage/terracotta palette with IIE brand tokens |
| `hooks/use-mobile.tsx`, toast hooks | **Reuse** | Generic |
| react-hook-form + zod + TanStack Query | **Reuse** (start using) | Exactly the right tools for IIE forms and API calls; zod schemas can be shared with the backend |
| Vite SPA shell (`main.tsx`, `App.tsx`, `vite.config.ts`) | **Refactor or replace** | SPA-only rendering is weak for SEO and first-load on slow mobile networks for product/country/storefront pages (see architecture §3) |
| `Header`, `Footer` | **Refactor** | Keep responsive structure; replace with route-based IIE navigation |
| `Hero`, `About`, `Services`, `Book`, `Testimonials` | **Remove** (for IIE) | Coaching content |
| `Contact.tsx` | **Remove** (for IIE); **fix** if the coaching site stays | Broken email flow |
| `App.css` | **Remove** | Unused |
| `lovable-tagger`, `bun.lockb` | **Remove** | Tooling leftovers; pick one package manager |

## 19. Code that should be removed

Covered in §18. Nothing should be removed until the §0 decision is made.

---

## 20. Prioritised implementation plan

Detailed architecture: [`IIE_PLATFORM_ARCHITECTURE.md`](./IIE_PLATFORM_ARCHITECTURE.md).
The phase order follows the brief; the bold items are on the critical path to the pilot
transaction.

| Phase | Scope | Key outputs | Exit criteria |
|---|---|---|---|
| **0** | Audit (this document) | Audit, architecture, mock audit | Repo decision made |
| **1** | Foundation | **Monorepo, CI, env config, Postgres + migrations, auth (email verify, password reset, sessions), RBAC, audit log, Country/Currency engine seeded for SLU + SVG**, user profiles, account statuses | A user can register, verify email, pick a country, and gets role-scoped access enforced server-side |
| **2** | Marketplace | **Seller onboarding + admin approval, storefront `/seller/:slug`, product CRUD with images/inventory/HS code, categories, search (Postgres full-text), cart** | Approved SLU seller lists diapers; SVG buyer finds and adds them to cart |
| **3** | Orders & transaction engine | **Checkout validation pipeline, order + price snapshot, transaction ID generator, transaction state machine with event log, notification service (in-app + email)** | Checkout creates `IIE-SLU-SVG-000001` in `AWAITING_PAYMENT`; seller is notified |
| **4** | Payments & currency | **Payment provider interface + sandbox provider, webhook ingestion (idempotent), FX provider + rate snapshots**, refunds, payout records | Sandbox payment moves transaction to `PAYMENT_CONFIRMED`; FX rate frozen on transaction |
| **5** | Logistics | **Logistics partner model + portal, shipment creation, status updates, tracking timeline, delivery confirmation**, document upload | Partner updates move shipment and transaction through to `DELIVERED`; buyer confirms |
| **6** | Compliance & disputes | Restricted-product rules per country, compliance checks + holds, KYC provider abstraction, dispute workflow + evidence | Checkout blocks a restricted SKU for a destination; dispute blocks payout |
| **7** | Admin & analytics | Admin console (users, products, transactions, countries, partners, compliance, finance), reconciliation reports | Admin can see and act on every stage of the pilot transaction |
| **8** | Production readiness | Pen test, load test, monitoring/alerting, backups/DR drill, licensed payment-partner go-live | Go-live checklist signed off |

## 21. Minimum changes for a real St. Lucia → St. Vincent MVP transaction

Target flow: seller in St. Lucia lists **baby diapers**; buyer in St. Vincent and the Grenadines
buys them; goods ship and are delivered; the seller is paid.

"Minimum" means everything below is required; everything else in the brief is deferred.

**Must build (software)**

1. Registration + email verification + login + password reset (buyer, seller, buyer+seller).
2. Roles: buyer, seller, logistics partner, admin (super admin). Server-enforced.
3. Country records for St. Lucia and SVG (currency XCD for both — which conveniently removes FX
   from the pilot path while still storing the FX fields at rate 1.0).
4. Seller onboarding form → `PENDING_VERIFICATION` → **manual admin approval** (KYC provider
   deferred; document upload + human review is sufficient for a pilot).
5. Product listing: name, description, category, images, price (XCD), stock, weight, dimensions,
   country of origin, HS code (diapers: HS 9619.00), status with admin review.
6. Product discovery: marketplace listing, product page, filter by seller country.
7. Cart (single seller per checkout for the MVP) and checkout with price snapshot, shipping
   quote (flat rate per lane configured by admin), platform fee, and an **explicit "duties and
   taxes are payable to the carrier/customs on arrival and are estimated at X"** line if real duty
   data is not available.
8. Transaction record with the IIE ID and the full state machine persisted, with an event log.
9. Payment through **one licensed provider in sandbox, then live** — the provider holds funds
   and IIE's software records a *payment hold*; release to the seller is triggered by IIE's state
   machine through the provider's payout/transfer API or, for the pilot, a documented manual payout
   recorded in IIE.
10. Seller notification (email + in-app) and seller "confirm order" action.
11. Logistics: admin assigns one partner (freight consolidator / courier on the SLU→SVG lane);
    partner portal to update status, add tracking number, upload commercial invoice / packing list.
12. Buyer tracking timeline and "confirm delivery" action; automatic confirmation after N days.
13. Dispute window (configurable, e.g. 3 days), then payout approval by admin.
14. Audit log of every state change and admin action.

**Must arrange (non-software, blocks go-live)**

- A **licensed payment partner** operating in St. Lucia/SVG/ECCU that supports marketplace
  collection and split/delayed payouts, and legal sign-off on the "transaction safeguard" wording.
  IIE must not hold client funds itself.
- A signed logistics partner for the SLU→SVG lane and agreed customs broker handling on arrival.
- Terms of service, privacy policy, seller agreement, refund/dispute policy.
- Confirmation that disposable diapers need no special import permit into SVG (believed to be a
  general good, but must be confirmed with SVG Customs/the broker).

**Deferred past MVP:** multi-seller carts, automated KYC/AML/sanctions providers, real FX,
duty calculation engine, SMS, messaging, reviews, analytics, business-buyer tiers, additional
countries (the engine supports them; they just aren't configured).

## 22. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Wrong repository | Work lands in the wrong place | Resolve §0 before Phase 1 |
| Regulatory: holding buyer funds = money transmission/escrow | Legal exposure | Funds held only by a licensed provider; IIE software models "holds", not custody |
| No payment provider yet selected for ECCU | Blocks Phase 4 | Start provider due diligence now in parallel with Phases 1–3 |
| Customs data not available by API | Manual work | Manual document workflow is first-class in the design |
| Mobile connectivity | Poor UX | SSR for public pages, small bundles, image CDN |
| Scope size | Slippage | Strict phase gates; pilot lane only until Phase 8 |
