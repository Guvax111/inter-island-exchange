/**
 * First drafts of the Help Center, written from how the platform works today, for IIE staff to review, edit and
 * publish (Admin → Help Center). They are seeded as DRAFT and never overwrite an article that already exists, so
 * staff edits are safe. Text marked "[IIE to confirm]" needs a business answer before publishing.
 */
export interface HelpDraft {
  slug: string;
  title: string;
  audience: 'BUYER' | 'SELLER' | 'PARTNER' | 'ALL';
  summary: string;
  sortOrder: number;
  body: string;
}

export const HELP_DRAFTS: HelpDraft[] = [
  // ---------------------------------------------------------------- everyone
  {
    slug: 'what-is-iie',
    title: 'What is Inter-Island Exchange?',
    audience: 'ALL',
    summary: 'A marketplace for buying and selling between CARICOM countries, with payment, shipping and customs handled in one place.',
    sortOrder: 10,
    body: `Inter-Island Exchange (IIE) connects buyers and sellers across CARICOM countries. You can buy from a seller in another island and follow the order from payment to your door, including shipping and customs.

## How it works

1. A buyer places an order with a seller in another country and pays on the payment provider's secure page.
2. The seller confirms the order and packs it.
3. IIE's logistics partner collects the parcel, ships it, and clears customs (with a customs broker where needed).
4. The parcel is delivered and the buyer confirms it arrived.
5. After a short review period, the seller is paid.

Every order has an IIE number, such as **IIE-SLU-SVG-000001**: the seller's country, the buyer's country, and the order number. Use it whenever you contact IIE.

## Who holds the money

IIE does not hold your money. Payments are taken and held by a licensed payment provider, which refunds buyers or pays sellers on IIE's instructions. See [Your payment and your protection](/help/your-payment-and-protection).`,
  },
  {
    slug: 'contacting-iie',
    title: 'Contacting IIE',
    audience: 'ALL',
    summary: 'All messages go through IIE: buyers and sellers do not contact each other directly.',
    sortOrder: 20,
    body: `To keep everyone safe, buyers and sellers communicate only through IIE. You will not see each other's phone numbers or email addresses, and messages are never passed on without IIE reading them.

## Send IIE a message

Sign in and open **Messages**, then choose **New message**. If your question is about an order, enter its IIE number so we can find it straight away. We reply in the same conversation and send you an email when we do.

## Problems with an order

If something is wrong with an order you received, use **Report a problem** on the order page instead. That keeps the payment on hold while IIE looks into it. See [Reporting a problem with an order](/help/reporting-a-problem).

## Support hours

IIE's support team works **Monday to Friday, 8:00 am to 5:00 pm** (St. Vincent time), except public holidays. Messages sent outside these hours are answered on the next working day.`,
  },
  {
    slug: 'your-payment-and-protection',
    title: 'Your payment and your protection',
    audience: 'ALL',
    summary: 'How payments are held, refunded and released, and what IIE never stores.',
    sortOrder: 30,
    body: `## Payments are held by a licensed provider

When a buyer pays, the money goes to IIE's licensed payment provider, not to IIE and not to the seller. The provider holds it until the order is complete:

- If the seller does not confirm the order within **48 hours**, the buyer is refunded in full automatically.
- If the buyer reports a problem, the seller's payment stays on hold until IIE decides.
- Otherwise the seller is paid **7 days after the delivery is confirmed**.

## Card details

You pay on the provider's own secure page. IIE never sees or stores card numbers, security codes or bank passwords.

## Duties and taxes

Import duties and taxes are **not** part of your payment to IIE. They are estimated at checkout and paid on arrival to customs in your country. See [Import duties and taxes](/help/import-duties-and-taxes).`,
  },

  // ---------------------------------------------------------------- buyers
  {
    slug: 'placing-an-order',
    title: 'Placing and paying for an order',
    audience: 'BUYER',
    summary: 'From your cart to the payment page, and what happens next.',
    sortOrder: 100,
    body: `## Checkout

1. Add products from one seller to your cart and choose **Checkout**.
2. Choose your delivery address. Checkout shows the product cost, shipping, IIE's fee, and an **estimate** of import duties and taxes for your country.
3. Place the order. You then have **30 minutes** to pay; after that the order is cancelled and the items go back on sale.

## Paying

You are taken to the payment provider's secure page. When the provider confirms the payment, your order page updates and we email you. A bank transfer can take longer: your order stays reserved while the payment is processing.

## After you pay

The seller has **48 hours** to confirm your order. If they do not, or they decline it, you are refunded in full automatically.`,
  },
  {
    slug: 'import-duties-and-taxes',
    title: 'Import duties and taxes',
    audience: 'BUYER',
    summary: 'How IIE estimates duties from each country\'s tariff, and how you pay them.',
    sortOrder: 110,
    body: `Every product sold across borders has an HS code (Harmonized System commodity code). IIE uses it to look up the duty and VAT that apply **in your country**, and shows them on the product page and at checkout.

## What you see

- **From the tariff schedule**: the official description, the duty rate for the product's country of origin, and VAT.
- **IIE estimate**: where no official tariff line is loaded yet, IIE uses its own estimate and labels it clearly.

Goods from CARICOM countries often pay a lower (often zero) duty than goods made elsewhere.

## Paying duties

Duties and taxes are paid on arrival to customs in your country, not to IIE. The amount customs charges is final and can differ from the estimate.

## Goods that cannot be imported

If your country prohibits a product, checkout will not let you buy it.`,
  },
  {
    slug: 'delivery-and-confirming',
    title: 'Tracking and confirming delivery',
    audience: 'BUYER',
    summary: 'Follow your parcel, confirm it arrived, and when the seller is paid.',
    sortOrder: 120,
    body: `## Tracking

Your order page shows each step: ready for pickup, collected, in transit, arrived, customs, out for delivery, delivered. You can also track by IIE number on the **Track** page.

## Proof of delivery

The logistics partner records who received the parcel and when, and may add a photo or signature. You can see these on your order page.

## Confirm delivery

When your parcel arrives, open the order and choose **Confirm delivery**. If you do nothing, the delivery is confirmed automatically after **3 days**.

After confirmation you still have **7 days** to report a problem before the seller is paid.

## Leave a review

Once you have confirmed delivery you can rate the order and write a review. IIE checks every review before it is published.`,
  },
  {
    slug: 'reporting-a-problem',
    title: 'Reporting a problem with an order',
    audience: 'BUYER',
    summary: 'Damaged, missing or wrong items: how to report them and what IIE can decide.',
    sortOrder: 130,
    body: `You can report a problem from the moment your order is delivered until the 7-day review period ends.

## How to report

1. Open the order and choose **Report a problem**. Say what is wrong.
2. Add photos in the conversation (for example the box and the items).
3. The seller's payment is put on hold.

Your messages go to IIE only. IIE asks the seller for their side and may share your photos with them.

## What IIE can decide

- **Full refund**: all your payment back. IIE may ask you to return the goods, with instructions.
- **Partial refund**: part of your payment back (for example for a missing item).
- **Release to the seller**: when the order was delivered as described.

Refunds go back through the payment provider to the way you paid. [IIE to confirm] Refunds usually reach you within 5 to 10 working days, depending on your bank.`,
  },
  {
    slug: 'reviews-guidelines',
    title: 'Reviews: what we publish',
    audience: 'BUYER',
    summary: 'Ratings and written reviews are checked by IIE before they appear.',
    sortOrder: 140,
    body: `You can review each order once, after confirming delivery. Choose 1 to 5 stars and, if you like, write a few words.

IIE reads every review before it is published. Reviews appear with your first name, initial and country.

## We do not publish reviews that

- include phone numbers, email addresses, links or other contact details;
- contain abusive, discriminatory or personal remarks;
- are about something other than the order (for example IIE's shipping partner only [IIE to confirm]);
- appear to be written for payment or by the seller.

If we do not publish your review, we tell you why.`,
  },

  // ---------------------------------------------------------------- sellers
  {
    slug: 'becoming-a-seller',
    title: 'Becoming a seller',
    audience: 'SELLER',
    summary: 'Sign up, upload your documents, and what IIE checks before approving you.',
    sortOrder: 200,
    body: `## Sign up

Create an account as a seller, then complete your seller profile and storefront (name, description, policies and logo).

## Documents

Before IIE can approve you, upload one of:

- **proof of business registration** (certificate of registration or trade licence), or
- **a government-issued ID** from your country (national ID card, passport or driver's licence).

PDF or photo, up to 10 MB. Documents are private: only IIE's review team can open them.

## Review

IIE checks your details and documents and approves your account, asks for changes, or explains why it cannot approve it. You get an email either way. Once approved, you can list products.`,
  },
  {
    slug: 'listing-products',
    title: 'Listing products and HS codes',
    audience: 'SELLER',
    summary: 'Product details buyers and customs need, including the HS code and country of origin.',
    sortOrder: 210,
    body: `Each product needs a title, description, category, price, stock, weight and, for cross-border sale, an **HS code** and **country of origin**.

## HS codes

The HS code tells customs what the product is. When you enter it, IIE shows the official description and the duty and VAT in each country you ship to. Use the most specific code you can (for example 9619.00 for diapers). If you are not sure, search the tariff on the **Tariffs** page or message IIE.

## Country of origin

Where the product was made, not where you are. CARICOM-made goods usually pay less duty.

## Approval

IIE reviews new products before they appear on the marketplace. Some goods cannot be imported into some countries; buyers there will not be able to buy them.`,
  },
  {
    slug: 'handling-orders',
    title: 'Confirming and shipping orders',
    audience: 'SELLER',
    summary: 'Confirm within 48 hours, pack, and hand over to IIE\'s logistics partner.',
    sortOrder: 220,
    body: `## Confirm within 48 hours

When a buyer pays, you get an email. Open the order and **Confirm** it, or **Decline** with a reason (the buyer sees it). If you do nothing for 48 hours, the order is declined and the buyer refunded automatically.

## Pack and mark ready

Pack the order securely and choose **Ready for pickup**, with the parcel weight. IIE's logistics partner collects it and handles export, shipping, customs and delivery. You can follow each step on the order page and print the commercial invoice.

The buyer's full address goes only to the logistics partner.`,
  },
  {
    slug: 'getting-paid',
    title: 'Getting paid',
    audience: 'SELLER',
    summary: 'When payouts are released, and what can be deducted.',
    sortOrder: 230,
    body: `You are paid **7 days after the buyer confirms delivery** (or after it is confirmed automatically, 3 days after delivery). The payment provider pays you directly.

## Your payout

Your payout is the product cost, less IIE's fee if you pay it. **Payouts** in your dashboard shows each order's payout, its status and when it is due.

## Deductions

If IIE decides a full refund after delivery and you are responsible for the carrier's shipping charge, that amount is kept back from your next payouts. Deductions are shown on the Payouts page.

## Problems reported by buyers

If a buyer reports a problem, the payout is held until IIE decides. See [Disputes and refunds for sellers](/help/disputes-for-sellers).`,
  },
  {
    slug: 'disputes-for-sellers',
    title: 'Disputes and refunds for sellers',
    audience: 'SELLER',
    summary: 'How IIE handles a problem reported by a buyer, and your part in it.',
    sortOrder: 240,
    body: `When a buyer reports a problem, you get an email and the payout is held.

## Give your side

Open the order and reply in the conversation. Add photos if they help (for example of the packing). Your messages go to IIE only; IIE decides what to share with the buyer.

## Decisions

- **Release to you**: you are paid in full.
- **Partial refund**: the refund comes out of your payout; the rest is paid to you straight away.
- **Full refund**: the buyer gets all their payment back and you are not paid for the order. IIE also decides whether the goods must be returned, and whether you or IIE pay the carrier's shipping charge.

Decisions are explained in the conversation and by email.`,
  },

  // ---------------------------------------------------------------- partners
  {
    slug: 'partner-portal',
    title: 'Using the partner portal',
    audience: 'PARTNER',
    summary: 'For logistics partners and customs brokers: shipments, steps and proof of delivery.',
    sortOrder: 300,
    body: `IIE invites your staff to the partner portal. Each person signs in with their own account.

## Shipments

**Shipments** lists the parcels assigned to your company. Open one to see the pickup address, delivery address, parcel details and the commercial invoice.

## Recording steps

Record each step as it happens: pickup scheduled, picked up, export, in transit, arrived. Customs brokers record customs processing, holds and clearance, and can enter the entry number and assessed duties.

## Proof of delivery

When you deliver, record the recipient's name and the time. Add a photo or signature where you can. The buyer then has 3 days to confirm or report a problem.

## Payment

IIE pays for each delivered shipment **45 days after delivery** [IIE to confirm payment method and statements].`,
  },
];
