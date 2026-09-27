# IIE Payment Architecture

**Status:** Phases 4, 6 and 7. Built against a **sandbox provider** until a licensed payment, banking or escrow provider is
contracted. No real money moves.

## Principles

1. **IIE does not hold funds.** The buyer's money is captured and held by a licensed provider. IIE records what the
   provider holds and instructs it (refund, later release). IIE is not represented as an escrow or money transmitter.
2. **No card data at IIE.** Buyers pay on the provider's hosted page. IIE stores the provider's payment IDs, amounts
   and statuses, never card numbers, CVVs or bank credentials.
3. **The provider is replaceable.** All payment code talks to the `PaymentProvider` interface. Adding the contracted
   provider means one adapter and one configuration value (`PAYMENT_PROVIDER`), not changes to orders, the ledger or the UI.
4. **The webhook is the source of truth.** The buyer's browser returning from the payment page proves nothing; only a
   verified provider event changes an order.
5. **Money history is append-only.** Payment events, ledger entries and exchange rates cannot be updated or deleted
   (database triggers). Corrections are new entries.

## Provider interface

`apps/api/src/payments/payment.provider.ts`

| Method | Purpose |
|---|---|
| `createIntent({ transaction, amount, currency, returnUrl, idempotencyKey })` | Opens a payment at the provider; returns the provider's ID and the hosted-page URL to send the buyer to |
| `refund({ providerIntentId, amount, currency, reason, idempotencyKey })` | Full or partial refund; returns the provider's refund ID and `SUCCEEDED` or `PENDING` |
| `payout({ reference, amount, currency, sellerReference, idempotencyKey })` | Pays the seller from held funds; `SUCCEEDED` or `PENDING` (then a payout webhook) |
| `parseWebhook(headers, rawBody)` | Verifies the signature over the raw body and parses the event; throws on anything invalid |

Normalised events: `payment.succeeded`, `payment.failed`, `payment.processing`, `refund.succeeded`, `refund.failed`, `payout.succeeded`, `payout.failed`.

### Sandbox provider

| Behaviour | Detail |
|---|---|
| Hosted page | `GET /api/v1/sandbox-pay/{id}?token=…`, headed **"SANDBOX PAYMENT PAGE · NO REAL MONEY"**. The tester picks the bank's answer: *Pay successfully*, *Decline the card*, or *Bank transfer (pending)* |
| Page token | HMAC of the payment ID with `SANDBOX_PAYMENT_SECRET`; without it the page is "not found" |
| Webhooks | The page's answer is delivered as an HMAC-SHA256 signed event (`x-sandbox-signature: t=<unix>,v1=<hex>`) through **the same verification and processing path** a real provider's webhook uses. Signatures older than 5 minutes are refused |
| Refunds | Succeed immediately |
| Where it may run | `local`, `test`, `staging`. **Production refuses to start** with `PAYMENT_PROVIDER=sandbox` |

The sandbox page and the webhook endpoint ignore the session cookie: they are authenticated by their own token or
signature, so a signed-in visitor's session grants nothing there.

## Flow

```
Buyer                 IIE web / API                          Provider (sandbox today)
  | Pay EC$149.50  -->  POST /me/orders/{id}/pay
  |                     reuse open attempt, or createIntent ----> hosted page URL
  | <-- redirect to hosted page
  | pays on provider page ------------------------------------------>
  |                     POST /webhooks/payments/{provider} <---- signed event
  |                     verify, store, de-duplicate, process
  | <-- redirect back to /orders/{id}?payment=…  (page polls until the webhook has landed)
```

### Webhook processing

1. The raw body is verified by the provider adapter. Invalid signature → `400`, nothing stored.
2. The event is stored in `provider_webhooks` keyed by `(provider, event_id)`. A duplicate returns `200` with the
   original result and is not processed again.
3. Processing runs in one database transaction with the order row locked. The result is recorded on the webhook row:

| Event and state | Result | What happens |
|---|---|---|
| succeeded, order awaiting payment (or payment failed/processing) | `CONFIRMED` | Order → `PAYMENT_CONFIRMED` → `AWAITING_SELLER_CONFIRMATION`; reserved stock becomes sold (`SALE` movement); ledger capture posting; seller payout created **ON_HOLD**; 48-hour seller deadline set; buyer and seller emailed |
| succeeded, amount or currency differs from the order | `AMOUNT_MISMATCH_HELD` | Order → `COMPLIANCE_HOLD` for IIE review; nothing is captured into the ledger |
| succeeded, order already cancelled (paid after the 30-minute window) | `LATE_PAYMENT_REFUNDED` | Refunded in full at once; order → `REFUNDED` |
| failed | `FAILED` | Order → `PAYMENT_FAILED`; stock stays reserved until the original 30-minute deadline, and the buyer can retry |
| processing (e.g. bank transfer) | `PROCESSING` | Order → `PAYMENT_PROCESSING`; **not** cancelled by the 30-minute expiry; completes or fails on the next event |
| anything else | `IGNORED_STATE` / `IGNORED_TYPE` / `UNKNOWN_INTENT` | Stored for review, no change |

If processing throws, the webhook row keeps the error and the provider's retry is processed again.

## Seller confirmation (48 hours)

| Action | Who | Result |
|---|---|---|
| Confirm | Seller, from the order page | `SELLER_CONFIRMED`; buyer emailed |
| Decline (with a reason the buyer sees) | Seller | Full refund, sold units returned to stock (`RETURN` movement), payout cancelled, order `REFUNDED` |
| No answer in 48 hours | Worker (`SYSTEM`) | Same as decline, reason "The seller did not confirm within 48 hours" |

The worker checks every poll interval. Each overdue order is refunded in its own database transaction; one that fails
is logged and retried on the next tick without blocking the others.

## Ledger

Double-entry, per transaction, in the transaction currency (minor units). Accounts:

| Account | Meaning |
|---|---|
| `provider_held` | Money the provider holds for this transaction (debit balance) |
| `seller_payable` | Owed to the seller when the transaction completes |
| `iie_fee_revenue` | IIE platform fee |
| `logistics_payable` | Owed to the logistics partner for shipping |
| `seller_receivable` | Owed to IIE by the seller (e.g. shipping on a full refund the seller bears) — Phase 7 |
| `iie_shipping_expense` | Shipping IIE bears on a full refund — Phase 7 |
| `iie_cash` | Money IIE has received from the provider or paid to partners — Phase 7 |

Capture: `provider_held` Dr total = `seller_payable` Cr payout + `iie_fee_revenue` Cr fee + `logistics_payable` Cr shipping.
A full refund posts the exact reverse, so every account nets to zero.

Every posting must balance: checked in code and again by the database when the transaction commits
(`ledger_entries_balanced`, a deferred constraint trigger). Entries cannot be edited or deleted.

**Duties are not in the ledger.** Duties and import taxes are an estimate shown at checkout and paid by the buyer to
customs on arrival. IIE does not collect them.

Pilot example (2 × EC$45.00 diapers, St. Lucia → St. Vincent, buyer pays the 5% fee):

| Account | Dr | Cr |
|---|---|---|
| provider_held | EC$149.50 | |
| seller_payable | | EC$90.00 |
| iie_fee_revenue | | EC$4.50 |
| logistics_payable | | EC$55.00 |

If the seller pays the fee instead, the buyer pays EC$145.00 and the seller is owed EC$85.50.

## Payouts (Phase 6)

A payout row is created **ON_HOLD** when the payment is confirmed. The seller is paid **7 days after delivery is
confirmed** (by the buyer, or automatically 3 days after delivery):

```
DELIVERY_CONFIRMED ─▶ DISPUTE_WINDOW (review_ends_at = +7 days; the buyer can still report a problem)
  worker, when it ends ─▶ PAYOUT_APPROVED ─▶ PAYOUT_PROCESSING ─ provider.payout() ─▶ COMPLETED
```

`PaymentProvider.payout` pays the seller out of the funds the provider holds (idempotency key = payout id). When it
settles at once the transaction completes; otherwise it stays `PAYOUT_PROCESSING` until a `payout.succeeded` or
`payout.failed` webhook. A failed payout can be retried by IIE (*Admin → Payouts → Retry*, `payout.approve`).

Ledger at payout: `seller_payable` Dr / `provider_held` Cr (payout amount). The IIE fee and the shipping stay in
`provider_held` until the provider remits them to IIE (see [Settlements](#settlements-phase-7)).

**Amounts the seller owes IIE** (seller charges, e.g. shipping on a full refund the seller bears) are kept back from
the seller's next payouts, oldest first, when a payout is first released: `seller_payable` Dr / `seller_receivable` Cr.
The payout is reduced by that amount (`payouts.deducted_minor`) and the seller sees it on their Payouts page.

Payouts run on the **sandbox provider** (no real money) until a licensed provider is contracted.

## Disputes and refunds (Phase 6)

A buyer can report a problem from delivery until the review period ends. The payout stays on hold; buyer, seller and
IIE exchange messages with photo evidence. IIE (`dispute.resolve`) decides:

| Decision | Money | Transaction | Goods |
|---|---|---|---|
| Full refund | Whole payment back to the buyer (provider refund); capture posting reversed; payout cancelled | `DISPUTED → REFUNDED` | Returned or kept: decided case by case, with instructions |
| Partial refund | Amount back to the buyer, **borne by the seller** (at most the payout); ledger `seller_payable` Dr / `provider_held` Cr; payout reduced; the rest paid out at once | `DISPUTED → PARTIALLY_REFUNDED → PAYOUT_APPROVED → … → COMPLETED` | Case by case |
| Release to seller | Payout paid at once | `DISPUTED → PAYOUT_APPROVED → … → COMPLETED` | Buyer keeps them |

Refund rows use their id as the provider idempotency key. The decision, amount, return instructions and explanation are
recorded on the dispute, posted to the conversation, audited and emailed to both parties.

**Shipping on a full refund (Phase 7).** Disputes open only after delivery, so the carrier is still owed its charge.
IIE must choose who pays it when deciding a full refund (`shippingBorneBy`, required):

| Bearer | Ledger | Effect |
|---|---|---|
| Seller | `seller_receivable` Dr / `logistics_payable` Cr | A seller charge, kept back from the seller's next payouts |
| IIE | `iie_shipping_expense` Dr / `logistics_payable` Cr | IIE's cost |

Either way IIE pays the carrier on the normal terms (net 45 from delivery).

**Messaging.** Buyer and seller write to IIE only and see only messages addressed to them; IIE chooses who sees each of
its messages and can share a party's message and photo with the other side.

## Settlements (Phase 7)

What IIE is owed and owes per transaction (`settlements`):

| Kind | Created | Amount | Due | Recorded as paid |
|---|---|---|---|---|
| `PROVIDER_REMITTANCE` (provider → IIE) | When the seller payout completes | Everything the provider still holds for the order: IIE fee, shipping, and anything kept back from the seller | **30 days** after the payout | `iie_cash` Dr / `provider_held` Cr |
| `LOGISTICS_PAYMENT` (IIE → logistics partner) | When the partner records delivery | The order's shipping charge | **45 days** after delivery | `logistics_payable` Dr / `iie_cash` Cr |

*Admin → Settlements* (`payout.approve`) lists what is due, overdue and settled; IIE records each payment with its bank
or provider reference and date (audited). When both are settled, every account for the order nets to zero except IIE's
fee revenue and cash. The weekly directors' report shows what is overdue and due in the next 14 days.

Assumption to confirm with the provider: it remits IIE's share per transaction (the settlement rows can be grouped when
its statements arrive in batches).

## Exchange rates

Every transaction stores the rate and source it was priced with (`fx_rate`, `fx_source`, `fx_recorded_at`) and is never
recalculated. Same-currency lanes (the pilot: XCD → XCD) record rate 1, source `SAME_CURRENCY`. Other rates are
entered by administrators (*Admin → Exchange rates*, `config.manage`, audited, append-only); seeded pegs: USD→XCD 2.70,
USD→BBD 2.00. A live rate feed can be added behind `FxService`.

## Data

| Table | Holds | Mutability |
|---|---|---|
| `payment_intents` | One row per payment attempt: provider, provider ID, amount, currency, status | Status updates only |
| `payment_events` | Every payment and refund event | Append-only |
| `provider_webhooks` | Raw verified webhooks, de-duplication key, processing result or error | Result recorded once |
| `refunds` | Refund requests: amount, reason, requested by, provider refund ID, status | Status updates only |
| `payouts` | Seller payout per transaction: amount, status | Status updates only |
| `ledger_entries` | Double-entry lines grouped by posting | Append-only, balanced |
| `seller_charges` | Amounts a seller owes IIE, with what remains to recover | Remaining reduced as recovered |
| `settlements` | Provider remittances and partner payments per transaction | Paid once, with a reference |
| `exchange_rates` | Rates with source and effective time | Append-only |

## API

| Method and path | Who | Purpose |
|---|---|---|
| `POST /me/orders/{iieId}/pay` | Buyer | Start or resume payment; returns `redirectUrl` |
| `POST /me/sales/{iieId}/confirm` | Seller | Confirm a paid order |
| `POST /me/sales/{iieId}/decline` `{reason}` | Seller | Decline and refund |
| `POST /webhooks/payments/{provider}` | Provider | Signed events |
| `GET/POST /sandbox-pay/{id}` | Tester (sandbox only) | Sandbox hosted page |
| `GET /admin/transactions/{iieId}/money` | `transaction.read.any` (country-scoped) | Payments, refunds, ledger and balances |
| `GET /admin/payouts` | `payout.approve` | Payouts (with amounts kept back) |
| `GET /admin/settlements?status=&kind=&overdue=` | `payout.approve` | Settlements |
| `POST /admin/settlements/{id}/paid` `{reference, paidOn?}` | `payout.approve` | Record a remittance received or a partner payment |
| `GET /me/payouts` | Seller | Payouts and amounts owed to IIE (`charges`) |
| `GET/POST /admin/exchange-rates` | `config.manage` | Exchange rates |

## Adding the contracted provider

1. Implement `PaymentProvider` for it (hosted checkout or payment link, refunds, webhook signature check) and add its
   key to `PAYMENT_PROVIDER`.
2. Put its API keys and webhook secret in the environment's secret store (never in the repository or the database).
3. Register its webhook URL: `https://<site>/api/v1/webhooks/payments/<key>`.
4. Run the payment test suite against its sandbox, then the end-to-end test.
5. Legal and compliance review of the hold/release arrangement before production.

Open questions for the provider: supported currencies (XCD at minimum), whether funds can be held until delivery
(authorisation window or a held-funds product), payout mechanism to sellers in each country, refund timing, fees,
dispute/chargeback handling.
