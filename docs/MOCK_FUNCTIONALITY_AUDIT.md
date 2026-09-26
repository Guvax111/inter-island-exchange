# Mock Functionality Audit — IIE

Tracks every IIE button, link, product card, dashboard action, form and navigation item that
is not yet connected to real functionality.

**Rule:** each control is either connected to real functionality, removed, or visibly labelled
"Coming soon". No control may look functional and do nothing. Product cards must link to real
product records; no static or fake product data in production workflows.

The Phase 0 audit of the previous repository (`Guvax111/lockeys-oasis-website`) is kept in that repository.

Status after Phase 2. Every control below is clearly labelled; none pretends to work.

| # | Page | Component | Mock functionality | Recommended fix | Implementation status |
|---|---|---|---|---|---|
| 1 | Header/footer, `/marketplace` | `PRIMARY_NAV` | — | — | **Done (Phase 2):** real search over approved products |
| 2 | `/logistics` | `ComingSoon` | Logistics not built | Partner portal and shipments | Labelled **Coming soon** (Phase 5) |
| 3 | `/business-solutions` | `ComingSoon` | No business tools yet | Business buyer/seller features | Labelled **Coming soon** (Phase 7) |
| 4 | `/help` | `ComingSoon` | No help content | Write help center | Labelled **Coming soon** (Phase 7) |
| 5 | `/contact` | `ComingSoon` | No IIE contact details available | Add IIE's official contact details or a support form | Labelled **Coming soon** — needs IIE's details |
| 6 | Home, `/track` | "Track a Shipment" card | Tracking not built | Shipment tracking | Labelled **Coming soon** (Phase 5) |
| 7 | Home | "Shop the Marketplace" card | — | — | **Done (Phase 2)** |
| 8 | `/how-it-works` | Step list | Steps 4–8 not built | Build per roadmap | Each step badged **Available now** or **Coming soon** |
| 9 | `/[country]` | "Shipping and logistics partners" | No partners yet | Phase 5 | Text says they will be listed there. (Local sellers and products are **live** since Phase 2) |
| 10 | `/payment-security` | Transaction Safeguard section | No payment partner yet | Phase 4 | States payments are not live yet |
| 11 | `/cart` | "Checkout — coming soon" button | Checkout not built | Phase 3 | **Disabled** and labelled |
| 12 | `/dashboard/buyer` | Orders card | No orders yet | Phase 3 | Text says orders appear once checkout opens |
| 13 | `/seller/{slug}` | Rating / completed orders | No orders or reviews yet | Phases 3 and 7 | Shows "New seller on IIE"; no fake ratings |

Working, not mock: sign-up, email verification, login (with two-step verification), password reset and change,
signed-in devices, onboarding, account deletion request, `/countries`, every country page, marketplace search,
product pages, storefronts, cart, saved items, addresses, seller dashboard (store, products, photos, stock),
admin users, seller and product review queues, categories, countries and lanes, audit log. Every product card
links to a real product record; there is no static product data.
