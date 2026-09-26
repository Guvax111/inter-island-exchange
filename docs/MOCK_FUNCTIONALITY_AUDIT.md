# Mock Functionality Audit — IIE

Tracks every IIE button, link, product card, dashboard action, form and navigation item that
is not yet connected to real functionality.

**Rule:** each control is either connected to real functionality, removed, or visibly labelled
"Coming soon". No control may look functional and do nothing. Product cards must link to real
product records; no static or fake product data in production workflows.

The Phase 0 audit of the previous repository (`Guvax111/lockeys-oasis-website`) is kept in that repository.

Status after Phase 1. Every control below is clearly labelled; none pretends to work.

| # | Page | Component | Mock functionality | Recommended fix | Implementation status |
|---|---|---|---|---|---|
| 1 | Header/footer, `/marketplace` | `PRIMARY_NAV`, `ComingSoon` | Marketplace not built | Build catalogue and search | Labelled **Coming soon** (Phase 2) |
| 2 | `/logistics` | `ComingSoon` | Logistics not built | Partner portal and shipments | Labelled **Coming soon** (Phase 5) |
| 3 | `/business-solutions` | `ComingSoon` | No business tools yet | Business buyer/seller features | Labelled **Coming soon** (Phase 7) |
| 4 | `/help` | `ComingSoon` | No help content | Write help center | Labelled **Coming soon** (Phase 7) |
| 5 | `/contact` | `ComingSoon` | No IIE contact details available | Add IIE's official contact details or a support form | Labelled **Coming soon** — needs IIE's details |
| 6 | Home, `/track` | "Track a Shipment" card | Tracking not built | Shipment tracking | Labelled **Coming soon** (Phase 5) |
| 7 | Home | "Shop the Marketplace" card | Marketplace not built | See #1 | Labelled **Coming soon** |
| 8 | `/how-it-works` | Step list | Steps 3–8 not built | Build per roadmap | Each step badged **Available now** or **Coming soon** |
| 9 | `/[country]` | "Local sellers and products", "Shipping and logistics partners" | No listings or partners yet | Phase 2 listings, Phase 5 partners | Text says they open in a later release |
| 10 | `/payment-security` | Transaction Safeguard section | No payment partner yet | Phase 4 | States payments are not live yet |
| 11 | `/account` | Seller application card | Storefront not built | Phase 2 | Text says storefronts open in the next release |

Working, not mock: sign-up, email verification, login (with two-step verification), password reset and change,
signed-in devices, onboarding, account deletion request, `/countries`, every country page, admin users,
admin countries and lanes, audit log.
