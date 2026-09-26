# IIE Logistics Architecture

**Status:** Phase 5. Built and tested end to end; **no logistics partner selected yet**, so shipping prices at
checkout remain placeholder rates and public pages say "Partner to be announced".

## Decisions (2026-09-26)

| Question | Decision |
|---|---|
| Logistics partner for St. Lucia → St. Vincent | To be determined. Partners, when selected, use the **IIE partner portal** |
| Shipping rates | Keep the placeholder rates until the partner's rates are agreed |
| Proof of delivery | Recipient name and time are required; a photo and/or a signature can be added |
| Automatic delivery confirmation | **3 days** after delivery is recorded, if the buyer neither confirms nor reports a problem |
| Customs | IIE uses **customs brokers in St. Vincent** when the logistics partner does not clear customs itself |

## Partners

Logistics partners (carriers) and customs brokers are **organisations configured by IIE** (`service_partners`), never
hard-coded. Each has a home country, contact details and an active flag.

| | Logistics partner | Customs broker |
|---|---|---|
| Serves | Trade lanes (`partner_lanes`), e.g. LC → VC | Its own country (customs clearance there) |
| Staff role | `logistics_partner` | `customs_broker` |
| Records | Pickup, transport, arrival, delivery, proof of delivery | Customs processing, clearance (entry number, duties assessed), holds and releases |
| Option | `clears_customs`: the carrier also clears customs, so no broker is needed | — |

**Staff** (`partner_members`) are invited by an IIE administrator (`partner.manage`) by email. A new person gets an account
in the partner's country and a 72-hour link to choose a password, which also verifies their email; an existing IIE
account is simply added. The partner role gives the permissions; **membership decides which shipments** a person can
see or change. Removing someone from their last partner of that kind removes the role.

## Assignment

When the seller marks a confirmed order **ready for pickup**, the shipment is created and assigned:

1. **Carrier:** the earliest-added active logistics partner with an active lane for the order's route.
2. **Customs party:** if the carrier clears customs, the carrier. Otherwise the earliest-added active customs broker whose
   country is the destination.

If no carrier (or no customs party) is available, the shipment is still created and appears under **Admin → Logistics →
Shipments needing attention**, where IIE assigns one. Assignment changes are audited and recorded in the tracking
history, and the new partner is notified (in-app to each team member, email to the partner's contact address).

## The journey

```
SELLER_CONFIRMED ─ seller: ready for pickup ─▶ PREPARING_SHIPMENT
  carrier ─▶ PICKUP_SCHEDULED ─▶ PICKED_UP (weight measured) ─▶ EXPORT_PROCESSING ─▶ IN_TRANSIT ─▶ ARRIVED_DESTINATION
  customs party ─▶ CUSTOMS_PROCESSING ─▶ CUSTOMS_CLEARED (entry no., duties assessed)
                                    └─▶ CUSTOMS_HOLD (reason) ─▶ released back to CUSTOMS_PROCESSING
  carrier ─▶ OUT_FOR_DELIVERY ─▶ DELIVERED (proof of delivery; 3-day clock starts)
  buyer ─▶ DELIVERY_CONFIRMED   or   buyer ─▶ DISPUTED ("report a problem")
  worker, after 3 days without either ─▶ DELIVERY_CONFIRMED
```

Every step goes through the central transaction engine (state machine, actor check, append-only transaction event)
and also writes an append-only **shipment event** with location and note. Steps must follow in order; a partner cannot
skip ahead. The carrier cannot record customs steps unless it clears customs; the broker cannot move the parcel.

### Weight check

The weight used for the shipping price at checkout is the **declared** weight (sum of product weights). The seller may
give a **packed** weight; the carrier records the **measured** weight at pickup. A parcel measured more than **10%**
over the declared weight is flagged to IIE ("Heavier than declared"). The buyer is not charged automatically; IIE
decides what to do.

### Customs and duties

Duties and taxes are an **estimate at checkout, paid by the buyer on arrival**, and never collected by IIE. When the
customs party records clearance it can enter the customs entry number and the **amount customs assessed**; the buyer then
sees that amount instead of the estimate.

The **commercial invoice and packing list** (`CI-<IIE ID>`) is generated from the order as placed: exporter (seller) and
consignee (buyer) with addresses and phones, each line's description, HS code, country of origin and CARICOM status,
quantity, values and net weight, goods value, freight and gross weight, plus the exporter's declaration. Partners print
it or save it as PDF from the portal.

### Proof of delivery

Recorded once per shipment (`delivery_proofs`, append-only): recipient name and time (required), optional photo and
optional signature drawn on screen, optional note, who recorded it. Rules: the time cannot be in the future or before the
parcel was ready for pickup (to the minute). Images are validated by content, re-encoded, stripped of metadata and are
**private**: the buyer, staff of the shipment's partners and IIE staff for either country can open them; the seller sees
the recipient's name and time only.

### Delivery confirmation

After delivery the buyer has **3 days** (`DELIVERY_CONFIRMATION_DAYS`, counted from when delivery is recorded) to confirm
receipt or **report a problem**. A report moves the order to `DISPUTED`, stops the automatic confirmation and keeps the
payout on hold; the seller and IIE are told. Resolution tools (refund, partial refund, release) are Phase 6. Without an
answer, the worker confirms the delivery; each order is confirmed in its own database transaction.

## Who sees what

| Data | Buyer | Seller | Carrier staff | Broker staff | IIE staff |
|---|---|---|---|---|---|
| Delivery address and buyer phone | ✓ | town and country only | ✓ | ✓ | ✓ (their countries) |
| Pickup address and seller phone | — | ✓ | ✓ | ✓ | ✓ |
| Tracking history | ✓ | ✓ | ✓ | ✓ | ✓ with actors |
| Weights | — | ✓ | ✓ | ✓ | ✓ with flag |
| Proof-of-delivery images | ✓ | — | ✓ | ✓ | ✓ |
| Shipments of other partners | — | — | — | — | ✓ |

Staff of a partner not assigned to a shipment get "not found" for it.

## Notifications

| When | Buyer | Seller | Partner |
|---|---|---|---|
| Ready for pickup | in-app | — | carrier: new shipment; broker: customs will be needed |
| Pickup scheduled, arrived, cleared | in-app | — | broker on arrival: clearance needed |
| Picked up ("shipped") | email | — | — |
| Customs hold | email | in-app | — |
| Out for delivery | email | — | — |
| Delivered | email (confirm within 3 days) | in-app | — |
| Delivery confirmed | in-app | email | — |
| Problem reported | email | email | — |

## Data

| Table | Holds | Rules |
|---|---|---|
| `service_partners` | Carriers and brokers | Kind, country, contact, `clears_customs`, active |
| `partner_members` | Staff per partner | Unique per partner and user |
| `partner_lanes` | Lanes a carrier serves | Unique per partner and lane; deactivated rather than deleted |
| `shipments` | One per transaction | Partner and broker, pickup and delivery snapshots, declared/packed/measured weights and flag, pickup time, references, customs entry and assessed duties |
| `shipment_events` | Tracking history | Append-only |
| `delivery_proofs` | Proof of delivery | Append-only, one per shipment |
| `transactions.delivery_confirm_due_at` | 3-day deadline | Partial index for the worker |

## API

| Method and path | Who | Purpose |
|---|---|---|
| `POST /me/sales/{iieId}/ready` | Seller | `{ parcelWeightGrams?, pickupNotes? }` |
| `POST /me/orders/{iieId}/confirm-delivery` | Buyer | Confirm receipt |
| `POST /me/orders/{iieId}/report-problem` | Buyer | `{ reason }` (10–1000 characters) |
| `GET /partner/shipments` | Partner staff | Shipments assigned to their partners |
| `GET /partner/shipments/{iieId}` | Partner staff | Detail, the user's roles and next steps |
| `GET /partner/shipments/{iieId}/commercial-invoice` | Partner staff | Customs document data |
| `POST /partner/shipments/{iieId}/steps` | Partner staff | `{ step, note?, location?, pickupAt?, actualWeightGrams?, trackingReference?, customsEntryNumber?, dutiesAssessed?, reason? }` |
| `POST /partner/shipments/{iieId}/delivery` | Carrier staff | Multipart: `recipientName`, `deliveredAt`, `note?`, files `photo?`, `signature?` |
| `GET /countries/{code}/partners` | Public | Names of active partners serving a country |
| `GET/POST/PATCH /admin/partners[/{id}]` | `partner.manage` | Partners and brokers |
| `POST/DELETE /admin/partners/{id}/lanes[/{laneId}]` | `partner.manage` | Lanes |
| `POST/DELETE /admin/partners/{id}/members[/{userId}]` | `partner.manage` | Staff invitations |
| `GET /admin/shipments?view=attention\|all` | `transaction.read.any` (country-scoped) | Shipments and issues |
| `PATCH /admin/shipments/{iieId}` | `partner.manage` | `{ logisticsPartnerId?, customsBrokerId? }` |

## When a partner is selected

1. *Admin → Logistics:* add the partner (tick "Clears customs itself" if it does), add the LC → VC lane, invite its staff.
2. Add the St. Vincent customs broker the same way (unless the partner clears customs).
3. *Admin → Checkout settings:* replace the placeholder shipping rates with the partner's rates and untick "placeholder".
4. Walk one test order through staging with the partner's staff.

An API connection to a partner's own system can be added later behind the same steps; the portal stays available.
