# Mock Functionality Audit — IIE

Tracks every IIE button, link, product card, dashboard action, form and navigation item that
is not yet connected to real functionality.

**Rule:** each control is either connected to real functionality, removed, or visibly labelled
"Coming soon". No control may look functional and do nothing. Product cards must link to real
product records; no static or fake product data in production workflows.

The Phase 0 audit of the previous repository (`Guvax111/lockeys-oasis-website`) is kept in that repository.

Status after Phase 3. Every control below is clearly labelled; none pretends to work.

| # | Page | Component | Mock functionality | Recommended fix | Implementation status |
|---|---|---|---|---|---|
| 1 | Header/footer, `/marketplace` | `PRIMARY_NAV` | — | — | **Done (Phase 2):** real search over approved products |
| 2 | `/logistics` | `ComingSoon` | Logistics not built | Partner portal and shipments | Labelled **Coming soon** (Phase 5) |
| 3 | `/business-solutions` | `ComingSoon` | No business tools yet | Business buyer/seller features | Labelled **Coming soon** (Phase 7) |
| 4 | `/help` | `ComingSoon` | No help content | Write help center | Labelled **Coming soon** (Phase 7) |
| 5 | `/contact` | Contact page | — | — | **Done:** IIE's address, email and phone (also in the footer) |
| 6 | Home, `/track` | "Track a Shipment" card | Tracking not built | Shipment tracking | Labelled **Coming soon** (Phase 5) |
| 7 | Home | "Shop the Marketplace" card | — | — | **Done (Phase 2)** |
| 8 | `/how-it-works` | Step list | Steps 5–8 not built | Build per roadmap | Each step badged **Available now** or **Coming soon** |
| 9 | `/[country]` | "Shipping and logistics partners" | No partners yet | Phase 5 | Text says they will be listed there. (Local sellers and products are **live** since Phase 2) |
| 10 | `/payment-security` | Transaction Safeguard section | No payment partner yet | Phase 4 | States payments are not live yet |
| 11 | `/cart`, `/checkout` | Checkout | — | — | **Done (Phase 3):** real quote and order placement |
| 14 | `/orders/{iieId}` | "Pay now — coming soon" button | Payments not connected | Phase 4 (licensed payment partner) | **Disabled** and labelled; the page explains unpaid orders are cancelled after 30 minutes without charge |
| 12 | `/dashboard/buyer` | Orders card | — | — | **Done (Phase 3):** links to real orders |
| 13 | `/seller/{slug}` | Rating / completed orders | No completed orders or reviews yet | Phases 6 and 7 | Shows "New seller on IIE"; no fake ratings |

Working, not mock: sign-up, email verification, login (with two-step verification), password reset and change,
signed-in devices, onboarding, account deletion request, `/countries`, every country page, marketplace search,
product pages, storefronts, cart, saved items, addresses, seller dashboard (store, products, photos, stock),
checkout, order placement with IIE transaction IDs, order pages and timelines, seller orders, notifications,
admin users, transactions, checkout settings, seller and product review queues, categories, countries and lanes,
audit log. Every product card
links to a real product record; there is no static product data.
