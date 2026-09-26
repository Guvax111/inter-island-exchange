/** Response shapes of the IIE API used by the web app. */
export interface Money {
  amountMinor: string;
  currency: string;
  formatted: string;
}

export interface SellerCard {
  slug: string;
  name: string;
  logoUrl?: string | null;
  country: string;
  countryName: string;
  verified?: boolean;
}

export interface ProductCard {
  id: string;
  title: string;
  shortDescription: string;
  priceFrom: Money;
  inStock: boolean;
  imageUrl: string | null;
  seller: SellerCard;
}

export interface SearchResult {
  items: ProductCard[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  children: CategoryNode[];
}

export interface PublicProduct {
  importInfo: { destination: { code: string; name: string }; tariff: TariffResolution | null }[];
  id: string;
  title: string;
  shortDescription: string;
  description: string;
  brand: string | null;
  hsCode: string | null;
  categoryPath: { slug: string; name: string }[];
  countryOfOrigin: { code: string; name: string } | null;
  weightGrams: number | null;
  dimensionsMm: { length: number; width: number; height: number } | null;
  attributes: Record<string, string>;
  images: { id: string; url: string; altText: string }[];
  inStock: boolean;
  variants: { id: string; sku: string; name: string; price: Money; available: number }[];
  seller: SellerCard;
  shipsFrom: { code: string; name: string };
  shipsTo: { code: string; name: string }[];
}

export interface Storefront extends SellerCard {
  description: string;
  shippingOrigin: string;
  returnPolicy: string;
  storePolicies: string;
  categories: { slug: string; name: string }[];
  memberSince: string;
  rating: number | null;
  completedTransactions: number | null;
  shipsTo: { code: string; name: string }[];
}

export interface SellerProduct {
  id: string;
  title: string;
  shortDescription: string;
  description: string;
  brand: string | null;
  hsCode: string | null;
  category: { slug: string; name: string } | null;
  categoryPath: { slug: string; name: string }[];
  countryOfOrigin: { code: string; name: string } | null;
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  status: string;
  reviewNotes: string | null;
  updatedAt: string;
  variants: { id: string; sku: string; name: string; price: Money; quantityOnHand: number; quantityReserved: number; archived: boolean }[];
  images: { id: string; url: string; altText: string }[];
}

export type LineIssue = 'UNAVAILABLE' | 'NOT_SHIPPABLE_TO_YOU' | 'INSUFFICIENT_STOCK';

export interface Cart {
  sellers: {
    seller: { slug: string | null; name: string; country: string; countryName: string };
    lines: {
      variantId: string;
      productId: string;
      title: string;
      variantName: string;
      sku: string;
      quantity: number;
      available: number;
      unitPrice: Money;
      lineTotal: Money;
      imageUrl: string | null;
      issues: LineIssue[];
    }[];
    subtotal: Money;
    readyForCheckout: boolean;
  }[];
  itemCount: number;
  notes: string[];
}

export function flattenCategories(nodes: CategoryNode[], depth = 0): { slug: string; label: string }[] {
  return nodes.flatMap((n) => [{ slug: n.slug, label: `${'— '.repeat(depth)}${n.name}` }, ...flattenCategories(n.children, depth + 1)]);
}

// ------------------------------------------------------------------ Phase 3

export interface Quote {
  quoteId: string;
  expiresAt: string;
  seller: { slug: string; name: string };
  shipsFrom: string;
  shipsTo: string;
  address: { line1: string; line2: string | null; city: string; region: string | null; country: string };
  lines: {
    sku: string;
    title: string;
    variantName: string;
    quantity: number;
    unitPrice: Money;
    lineTotal: Money;
    tariff: { hsCode: string; description: string; dutyPercent: number | null; vatPercent: number | null; source: string; kind: 'TARIFF_SCHEDULE' | 'IIE_ESTIMATE'; restriction: string; varies: boolean } | null;
  }[];
  weightKg: number;
  productCost: Money;
  shipping: Money & { serviceName: string; isPlaceholder: boolean };
  platformFee: Money & { percent: number; payer: 'BUYER' | 'SELLER'; chargedToBuyer: Money };
  otherFees: Money;
  dutiesEstimate: Money & { duty: Money; vat: Money; incomplete: boolean; isPlaceholder: boolean; paidWhen: 'ON_ARRIVAL' };
  total: Money;
  estimatedLandedTotal: Money;
}

export interface OrderSummary {
  iieId: string;
  status: string;
  statusLabel: string;
  total: Money;
  seller: { name: string; slug: string };
  buyerFirstName: string;
  route: string;
  paymentDueAt: string | null;
  createdAt: string;
}

export interface OrderDetail {
  iieId: string;
  status: string;
  statusLabel: string;
  subStatuses: Record<string, string>;
  paymentDueAt: string | null;
  canCancel: boolean;
  canPay: boolean;
  sellerConfirmDueAt: string | null;
  canMarkReady: boolean;
  canConfirmDelivery: boolean;
  deliveryConfirmDueAt: string | null;
  canReportProblem: boolean;
  reviewEndsAt: string | null;
  dispute: DisputeSummary | null;
  payout?: { status: string; amount: Money; paidAt: string | null; providerReference: string | null } | null;
  shipment: ShipmentView | null;
  seller: { name: string; slug: string };
  buyer: { firstName: string; lastName?: string; email?: string };
  deliveryAddress: Record<string, string | null>;
  items: {
    sku: string;
    title: string;
    variantName: string;
    quantity: number;
    unitPrice: Money;
    lineTotal: Money;
    hsCode: string | null;
    countryOfOrigin: string;
    tariff: { hsCode: string | null; description: string; dutyPercent: number | null; vatPercent: number | null; source: string | null } | null;
  }[];
  amounts: {
    productCost: Money;
    shipping: Money;
    platformFee: Money & { percent: number; payer: 'BUYER' | 'SELLER'; chargedToBuyer: Money };
    otherFees: Money;
    dutiesEstimate: Money & { collected: boolean };
    total: Money;
    sellerPayout?: Money;
  };
  currency: { transaction: string; fxRate: string; fxSource: string };
  timeline: { status: string; label: string; at: string; reason: string | null; from?: string | null; actorType?: string; actorUserId?: string | null }[];
  createdAt: string;
}

export interface NotificationList {
  unread: number;
  items: { id: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string }[];
}

export interface MoneyTrail {
  balanced: boolean;
  ledger: { posting: string; account: string; direction: 'DEBIT' | 'CREDIT'; amount: Money; description: string; at: string }[];
  balances: Record<string, Money & { side: 'DEBIT' | 'CREDIT' | 'NONE' }>;
  payments: { provider: string; providerIntentId: string; status: string; amount: Money; createdAt: string }[];
  refunds: { status: string; amount: Money; reason: string; requestedBy: string; providerRefundId: string | null; createdAt: string }[];
  events: { type: string; amount: Money | null; at: string }[];
}

export interface ShipmentEvent {
  step: string;
  label: string;
  location: string | null;
  note: string | null;
  at: string;
  actorType?: string;
}

export interface ShipmentView {
  logisticsPartner: { name: string; phone: string; clearsCustoms: boolean } | null;
  customsBroker: { name: string; phone: string } | null;
  trackingReference: string | null;
  pickupScheduledFor: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  customs: { entryNumber: string | null; dutiesAssessed: Money | null; payableOnArrival: boolean };
  weights?: { declaredGrams: number; parcelGrams: number; actualGrams: number | null; flagged?: boolean };
  events: ShipmentEvent[];
  proofOfDelivery: { recipientName: string; deliveredAt: string; note?: string | null; photoUrl: string | null; signatureUrl: string | null } | null;
}

export type ShipmentStep =
  | 'SCHEDULE_PICKUP'
  | 'PICKED_UP'
  | 'EXPORT_PROCESSING'
  | 'IN_TRANSIT'
  | 'ARRIVED_DESTINATION'
  | 'CUSTOMS_PROCESSING'
  | 'CUSTOMS_CLEARED'
  | 'CUSTOMS_HOLD'
  | 'CUSTOMS_RELEASED'
  | 'OUT_FOR_DELIVERY';

export interface PartnerShipmentSummary {
  iieId: string;
  status: string;
  statusLabel: string;
  route: string;
  pickupCity: string | null;
  deliveryCity: string | null;
  open: boolean;
  actionNeeded: boolean;
  createdAt: string;
}

export interface PartnerShipmentDetail {
  iieId: string;
  status: string;
  statusLabel: string;
  yourRoles: ('LOGISTICS' | 'CUSTOMS')[];
  nextSteps: ShipmentStep[];
  canDeliver: boolean;
  pickup: { address: Record<string, string | null>; contact: { name: string; phone: string | null }; notes: string };
  delivery: { address: Record<string, string | null>; contact: { name: string; phone: string | null } };
  items: { sku: string; title: string; variantName: string; quantity: number; unitWeightGrams: number }[];
  shipment: ShipmentView;
}

export interface SellerDocument {
  id: string;
  type: 'BUSINESS_REGISTRATION' | 'NATIONAL_ID';
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  fileName: string;
  contentType: string;
  bytes: number;
  reviewNote: string | null;
  uploadedAt: string;
  reviewedAt: string | null;
  url: string;
}

export const DOCUMENT_TYPE_LABELS: Record<SellerDocument['type'], string> = {
  BUSINESS_REGISTRATION: 'Proof of business registration',
  NATIONAL_ID: 'National ID',
};

export interface DisputeSummary {
  status: 'OPEN' | 'RESOLVED';
  reason: string;
  decision: 'FULL_REFUND' | 'PARTIAL_REFUND' | 'RELEASE_TO_SELLER' | null;
  refundAmount: Money | null;
  returnRequired: boolean;
  returnInstructions: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
}

export interface DisputeView extends Omit<DisputeSummary, 'status'> {
  iieId: string;
  status: string;
  statusLabel: string;
  disputeStatus: 'OPEN' | 'RESOLVED';
  yourRole: 'BUYER' | 'SELLER' | 'IIE';
  canMessage: boolean;
  openedAt: string;
  limits?: { total: Money; maxPartialRefund: Money | null };
  messages: { role: 'BUYER' | 'SELLER' | 'IIE'; author: string; body: string; photoUrl: string | null; at: string }[];
}

export const DECISION_LABELS: Record<NonNullable<DisputeSummary['decision']>, string> = {
  FULL_REFUND: 'Full refund to the buyer',
  PARTIAL_REFUND: 'Partial refund to the buyer',
  RELEASE_TO_SELLER: 'Payout released to the seller',
};

export interface TariffResolution {
  country: { code: string; name: string };
  hsCode: string;
  matchedHsCode: string;
  description: string;
  generalDutyPercent: number | null;
  caricomDutyPercent: number | null;
  applicableDutyPercent: number | null;
  vatPercent: number | null;
  vatFrom: 'TARIFF' | 'COUNTRY' | null;
  rateText: string | null;
  restriction: 'NONE' | 'LICENCE_REQUIRED' | 'PROHIBITED';
  notes: string | null;
  varies: boolean;
  source: { kind: 'TARIFF_SCHEDULE'; name: string; publisher: string; effectiveFrom: string } | { kind: 'IIE_ESTIMATE'; name: string; isPlaceholder: boolean };
}
