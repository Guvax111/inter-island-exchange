# IIE Transaction State Machine

**Status:** Implemented in Phase 3 (`apps/api/src/transactions/state-machine.ts`, `transaction-engine.ts`).
Phase 3 drives the order-placement and cancellation steps; later phases drive the rest through the same engine.

## One record per order

Every order creates exactly one row in `transactions` with a permanent **IIE ID**:

```
IIE-SLU-SVG-000001
 │   │   │   └── one global sequence (transaction_number_seq), zero-padded, grows past 6 digits if needed
 │   │   └────── destination country's IIE code (countries.iie_code)
 │   └────────── origin (seller) country's IIE code
 └────────────── Inter-Island Exchange
```

The ID cannot be changed (database trigger). The transaction holds the buyer, seller, origin and destination,
the six sub-statuses, currencies and exchange rate, and every amount frozen at order time.

## How a status changes

Only `TransactionEngine.transition(tx, id, to, actor, options)` changes a status. In one database transaction it:

1. locks the transaction row (`SELECT … FOR UPDATE`);
2. optionally checks the caller's expected `version` (lost-update protection);
3. checks the move is in the table below **and** that the actor type may make it;
4. updates `status`, `version + 1`, the sub-statuses for the new state, and the remembered hold origin;
5. inserts a row in `transaction_events` (append-only: updates and deletes are rejected by a trigger);
6. triggers notifications (`TransactionNotifier`).

Anything not listed is refused with `409 INVALID_TRANSITION`; the right move by the wrong actor gets `403`.

## Actors

| Actor | Who |
|---|---|
| BUYER | The buyer on their own order |
| SELLER | The seller on their own sale |
| ADMIN | IIE staff with the relevant permission |
| SYSTEM | IIE's own jobs (order placement, expiry, automatic steps) |
| PAYMENT | The payment provider, through verified webhooks (sandbox provider until a licensed one is contracted) |
| LOGISTICS | Staff of the shipment's assigned logistics partner (partner portal) |
| CUSTOMS | Whoever clears customs for the shipment: the assigned customs broker's staff, or the carrier's staff when it clears customs itself |
| COMPLIANCE | Compliance officer (Phase 6) |

## Main flow

| From | To | Allowed actors | Phase |
|---|---|---|---|
| (new) | CREATED | — (recorded when the order is placed) | 3 |
| CREATED | AWAITING_PAYMENT | SYSTEM (sets the 30-minute payment deadline) | 3 |
| AWAITING_PAYMENT | PAYMENT_PROCESSING / PAYMENT_CONFIRMED / PAYMENT_FAILED | PAYMENT | 4 |
| PAYMENT_PROCESSING | PAYMENT_CONFIRMED / PAYMENT_FAILED | PAYMENT | 4 |
| PAYMENT_FAILED | AWAITING_PAYMENT (retry) | BUYER, SYSTEM | 4 |
| PAYMENT_CONFIRMED | AWAITING_SELLER_CONFIRMATION | SYSTEM | 4 |
| AWAITING_SELLER_CONFIRMATION | SELLER_CONFIRMED | SELLER, ADMIN | 4 · the seller has **48 hours** from payment (`seller_confirm_due_at`) |
| SELLER_CONFIRMED | PREPARING_SHIPMENT | SELLER, SYSTEM | 5 · seller marks the order ready for pickup; the shipment is created and assigned |
| PREPARING_SHIPMENT | PICKUP_SCHEDULED | LOGISTICS, ADMIN | 5 |
| PICKUP_SCHEDULED → PICKED_UP → EXPORT_PROCESSING → IN_TRANSIT → ARRIVED_DESTINATION | | LOGISTICS | 5 |
| ARRIVED_DESTINATION | CUSTOMS_PROCESSING | LOGISTICS, CUSTOMS | 5 |
| CUSTOMS_PROCESSING | CUSTOMS_CLEARED | LOGISTICS, CUSTOMS | 5 |
| CUSTOMS_CLEARED → OUT_FOR_DELIVERY → DELIVERED | | LOGISTICS | 5 |
| DELIVERED | DELIVERY_CONFIRMED | BUYER, SYSTEM | 5 · SYSTEM confirms **3 days** after delivery is recorded (`delivery_confirm_due_at`) |
| DELIVERY_CONFIRMED | DISPUTE_WINDOW | SYSTEM | 6 · immediately; `review_ends_at` = +7 days |
| DISPUTE_WINDOW | PAYOUT_APPROVED | SYSTEM, ADMIN | 6 · SYSTEM when the review period ends |
| PAYOUT_APPROVED | PAYOUT_PROCESSING | SYSTEM, PAYMENT | 4/6 |
| PAYOUT_PROCESSING | COMPLETED | PAYMENT, SYSTEM | 4/6 |

## Exceptions

| From | To | Allowed actors | Notes |
|---|---|---|---|
| CREATED | CANCELLED | SYSTEM | |
| AWAITING_PAYMENT | CANCELLED | BUYER, SYSTEM, ADMIN | **Phase 3.** Buyer cancels, or the 30-minute window expires; reserved stock is released |
| PAYMENT_FAILED | CANCELLED | BUYER, SYSTEM, ADMIN | The retry window is the original 30-minute deadline |
| AWAITING_SELLER_CONFIRMATION | REFUNDED | SELLER, ADMIN, SYSTEM | **Phase 4.** Seller declines (with a reason), or SYSTEM after 48 hours without confirmation. Full refund, stock returned, payout cancelled |
| CANCELLED | REFUNDED | SYSTEM | **Phase 4.** A payment that arrives after the order was cancelled is refunded at once |
| CUSTOMS_PROCESSING | CUSTOMS_HOLD | LOGISTICS, CUSTOMS, ADMIN | Hold |
| CUSTOMS_HOLD | (state it interrupted) / REFUNDED | CUSTOMS, ADMIN / ADMIN | The customs party records the hold with a reason and the release |
| Any state from AWAITING_PAYMENT to DISPUTE_WINDOW | COMPLIANCE_HOLD | COMPLIANCE, ADMIN, SYSTEM | Hold. SYSTEM places it when the provider reports a paid amount or currency that differs from the order |
| COMPLIANCE_HOLD | (state it interrupted) / REFUNDED / CANCELLED | COMPLIANCE, ADMIN / ADMIN / ADMIN | |
| DELIVERED, DISPUTE_WINDOW | DISPUTED | BUYER | Hold; payout cannot be approved while open |
| DISPUTED | PAYOUT_APPROVED / REFUNDED / PARTIALLY_REFUNDED | ADMIN | Dispute outcomes |
| PARTIALLY_REFUNDED | PAYOUT_APPROVED | ADMIN, SYSTEM | Remaining amount to the seller |

**Holds** store the state they interrupted in `held_from_status`; leaving a hold returns there (tested).

Terminal states: COMPLETED, CANCELLED, REFUNDED.

## Sub-statuses

Set automatically when a state is entered:

| Column | Values (so far) | Set by |
|---|---|---|
| payment_status | NOT_STARTED, PENDING, PROCESSING, PAID, FAILED, REFUNDED, PARTIALLY_REFUNDED | payment states |
| shipment_status | NOT_STARTED, PICKUP_SCHEDULED, PICKED_UP, IN_TRANSIT, ARRIVED, OUT_FOR_DELIVERY, DELIVERED | logistics states |
| customs_status | NOT_STARTED, PROCESSING, HOLD, CLEARED | customs states |
| compliance_status | NOT_CHECKED, ON_HOLD (CLEAR, REVIEW_REQUIRED, REJECTED in Phase 6) | compliance |
| dispute_status | NONE, OPEN (outcomes in Phase 6) | disputes |
| payout_status | NOT_STARTED, APPROVED, PROCESSING, PAID, CANCELLED | payout states |

## Money on the transaction (Phase 3 pilot rules)

| Field | Meaning |
|---|---|
| subtotal_minor | Product cost (quantity × frozen unit price) |
| shipping_minor | From the lane's weight band |
| platform_fee_minor, platform_fee_bps, fee_payer | 5% of product cost; BUYER (added to total) or SELLER (deducted from payout) |
| other_fees_minor | 0 in the pilot |
| duties_estimate_minor, duties_collected = false | Estimated duty + VAT, **payable on arrival**, not collected by IIE |
| total_minor | What the buyer pays through IIE's payment partner |
| seller_payout_minor | What the seller receives on completion |
| transaction/buyer/payout currency, fx_rate, fx_source | XCD/XCD/XCD, 1, SAME_CURRENCY for the pilot; recorded so a completed transaction is never recalculated |

## Stock

Placing an order reserves stock (`inventory.quantity_reserved`, `inventory_reservations`) under row locks, so
the last unit cannot be sold twice. Cancellation or expiry releases it. Payment consumes the reservation (on-hand
and reserved both go down) and records a `SALE` movement; a refund before shipping puts the units back with a
`RETURN` movement. A payment still `PAYMENT_PROCESSING` (e.g. bank transfer) is not cancelled by the 30-minute
expiry.

## Payments

How payment events move a transaction, the ledger postings and refunds: [`IIE_PAYMENT_ARCHITECTURE.md`](IIE_PAYMENT_ARCHITECTURE.md).

## Logistics

How shipments are assigned, who records each step and how delivery is confirmed: [`IIE_LOGISTICS_ARCHITECTURE.md`](IIE_LOGISTICS_ARCHITECTURE.md). A buyer's "report a problem" moves `DELIVERED` to `DISPUTED` (hold); resolving disputes is Phase 6.

## Disputes and payouts

The buyer can move `DELIVERED` or `DISPUTE_WINDOW` to `DISPUTED`. IIE decides: `REFUNDED` (full refund), `PARTIALLY_REFUNDED` then `PAYOUT_APPROVED` (partial refund), or `PAYOUT_APPROVED` (release). From `PAYOUT_APPROVED` the payout goes to the provider (`PAYOUT_PROCESSING`) and the transaction ends `COMPLETED`. Details: [`IIE_PAYMENT_ARCHITECTURE.md`](IIE_PAYMENT_ARCHITECTURE.md#disputes-and-refunds-phase-6).
