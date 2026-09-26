# Mock Functionality Audit — IIE

Tracks every IIE button, link, product card, dashboard action, form and navigation item that
is not yet connected to real functionality.

**Rule:** each control is either connected to real functionality, removed, or visibly labelled
"Coming soon". No control may look functional and do nothing. Product cards must link to real
product records; no static or fake product data in production workflows.

The Phase 0 audit of the previous repository (`Guvax111/lockeys-oasis-website`) is kept in that repository.

Status after Phase 5. Every control below is clearly labelled; none pretends to work.

| # | Page | Component | Mock functionality | Recommended fix | Implementation status |
|---|---|---|---|---|---|
| 1 | Header/footer, `/marketplace` | `PRIMARY_NAV` | — | — | **Done (Phase 2):** real search over approved products |
| 2 | `/logistics` | Logistics page | — (no partner selected yet) | Select the SLU → SVG partner | **Done (Phase 5):** explains the shipping journey; states **Partner to be announced** and that shipping prices are provisional |
| 3 | `/business-solutions` | `ComingSoon` | No business tools yet | Business buyer/seller features | Labelled **Coming soon** (Phase 7) |
| 4 | `/help` | `ComingSoon` | No help content | Write help center | Labelled **Coming soon** (Phase 7) |
| 5 | `/contact` | Contact page | — | — | **Done:** IIE's address, email and phone (also in the footer) |
| 6 | Home, `/track` | "Track a Shipment" card | — | — | **Done (Phase 5):** signed-in buyers track by IIE transaction ID; guests are asked to sign in (tracking shows addresses and proof of delivery) |
| 7 | Home | "Shop the Marketplace" card | — | — | **Done (Phase 2)** |
| 8 | `/how-it-works` | Step list | Seller payout not built | Phase 6 | Each step badged **Available now**, **Test mode** (payment), **Partner to be announced** (shipping) or **Coming soon** (payout) |
| 9 | `/[country]` | "Shipping and logistics partners" | — | — | **Done (Phase 5):** lists the active partners and brokers serving the country; until one is selected it says IIE is selecting them |
| 10 | `/payment-security` | Transaction Safeguard section | Payments run on the sandbox provider | Contract a licensed provider and add its adapter | Labelled **Test mode**: states no real money moves |
| 11 | `/cart`, `/checkout` | Checkout | — | — | **Done (Phase 3):** real quote and order placement |
| 14 | `/orders/{iieId}` | "Pay EC$…" button | — (sandbox provider until one is contracted) | Licensed provider adapter | **Done (Phase 4):** opens the provider's hosted page. The sandbox page is headed "SANDBOX PAYMENT PAGE · NO REAL MONEY"; production refuses to start with the sandbox provider |
| 15 | `/admin/payouts` | Payout list | Payout release not built | Phase 6 (after the review period) | Read-only; the page states payouts stay on hold until release arrives |
| 16 | `/orders/{iieId}` | "Report a problem" | Resolution tools (refund, partial refund, release) not built | Phase 6 (disputes) | The report is real: recorded, seller and IIE told, automatic confirmation and payout stopped. The buyer is told IIE will contact them |
| 12 | `/dashboard/buyer` | Orders card | — | — | **Done (Phase 3):** links to real orders |
| 13 | `/seller/{slug}` | Rating / completed orders | No completed orders or reviews yet | Phases 6 and 7 | Shows "New seller on IIE"; no fake ratings |

Working, not mock: sign-up, email verification, login (with two-step verification), password reset and change,
signed-in devices, onboarding, account deletion request, `/countries`, every country page, marketplace search,
product pages, storefronts, cart, saved items, addresses, seller dashboard (store, products, photos, stock),
checkout, order placement with IIE transaction IDs, payment (sandbox provider), seller confirm/decline with the 48-hour automatic refund, admin money trail and exchange rates, seller ready-for-pickup, partner portal (tracking steps, customs steps, commercial invoice, proof of delivery with photo and signature), buyer delivery confirmation and 3-day automatic confirmation, admin logistics (partners, lanes, staff invitations, shipment assignment), order pages and timelines, seller orders, notifications,
admin users, transactions, checkout settings, seller and product review queues, categories, countries and lanes,
audit log. Every product card
links to a real product record; there is no static product data.
