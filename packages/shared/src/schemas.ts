import { z } from 'zod';
import { ACCOUNT_STATUSES, ACCOUNT_TYPES, FEE_PAYERS, MAX_CART_QUANTITY, PARTNER_KINDS, PARTY_TYPES, PRODUCT_STATUSES, TRANSACTION_STATUSES } from './statuses';
import { ROLES } from './rbac';

export const PASSWORD_MIN_LENGTH = 12;

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(128, 'Password must be at most 128 characters');
export const countryCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Use a 2-letter ISO country code');
export const phoneSchema = z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Use international format, e.g. +17585551234');
const name = z.string().trim().min(1).max(100);
const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: name,
  lastName: name,
  countryCode: countryCodeSchema,
  accountType: z.enum(ACCOUNT_TYPES),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const tokenSchema = z.object({ token: z.string().min(20).max(200) });
export const emailOnlySchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema });
export const totpCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export const passwordConfirmSchema = z.object({ password: z.string().min(1).max(128), reason: optionalText(1000) });

export const addressSchema = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: optionalText(200),
  city: z.string().trim().min(1).max(100),
  region: optionalText(100),
  postalCode: optionalText(20),
  countryCode: countryCodeSchema,
});
export type AddressInput = z.infer<typeof addressSchema>;

export const buyerOnboardingSchema = z
  .object({
    firstName: name,
    lastName: name,
    phone: phoneSchema,
    partyType: z.enum(PARTY_TYPES),
    businessName: optionalText(200),
    address: addressSchema,
  })
  .refine((v) => v.partyType !== 'BUSINESS' || !!v.businessName, { message: 'Business name is required', path: ['businessName'] });
export type BuyerOnboardingInput = z.infer<typeof buyerOnboardingSchema>;

export const sellerOnboardingSchema = z
  .object({
    partyType: z.enum(PARTY_TYPES),
    legalName: z.string().trim().min(1).max(200),
    businessName: optionalText(200),
    registrationNumber: optionalText(100),
    taxId: optionalText(100),
    phone: phoneSchema,
    website: z.union([z.url().max(300), z.literal('')]).optional().transform((v) => (v ? v : undefined)),
    category: z.string().trim().min(1).max(100),
    address: addressSchema,
  })
  .refine((v) => v.partyType !== 'BUSINESS' || !!v.businessName, { message: 'Business name is required', path: ['businessName'] })
  .refine((v) => v.partyType !== 'BUSINESS' || !!v.registrationNumber, {
    message: 'Business registration number is required',
    path: ['registrationNumber'],
  });
export type SellerOnboardingInput = z.infer<typeof sellerOnboardingSchema>;

export const countryUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    iieCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}$/),
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,50}$/),
    currencyCode: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
    marketplaceEnabled: z.boolean(),
    settings: z.record(z.string(), z.unknown()),
  })
  .partial();
export type CountryUpdateInput = z.infer<typeof countryUpdateSchema>;

export const countryCreateSchema = z.object({
  isoAlpha2: countryCodeSchema,
  isoAlpha3: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  name: z.string().trim().min(1).max(100),
  iieCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}$/),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,50}$/),
  currencyCode: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  regionalBloc: z.string().trim().max(20).default('CARICOM'),
  marketplaceEnabled: z.boolean().default(false),
  settings: z.record(z.string(), z.unknown()).default({}),
});
export type CountryCreateInput = z.infer<typeof countryCreateSchema>;

export const reasonSchema = z.object({ reason: z.string().trim().min(3).max(1000) });
export const grantRoleSchema = z.object({ role: z.enum(ROLES), countryCode: countryCodeSchema.optional() });
export const adminUserQuerySchema = z.object({
  status: z.enum(ACCOUNT_STATUSES).optional(),
  role: z.enum(ROLES).optional(),
  countryCode: countryCodeSchema.optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export const auditQuerySchema = z.object({
  entityType: z.string().max(50).optional(),
  entityId: z.string().max(100).optional(),
  actorUserId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

// ------------------------------------------------------------------ Phase 2: marketplace

export const slugSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens').min(3).max(60);
/** Decimal price as typed by a seller, e.g. "12.50". Converted to minor units on the server. */
export const priceInputSchema = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, 'Enter a price like 12.50');
/** Harmonized System code: 6 to 10 digits, dots optional (e.g. 9619.00 or 961900). */
export const hsCodeSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[.\s]/g, ''))
  .pipe(z.string().regex(/^\d{6,10}$/, 'Enter a 6 to 10 digit HS code, e.g. 9619.00'));

export const sellerProfileUpdateSchema = z
  .object({
    legalName: z.string().trim().min(1).max(200),
    businessName: optionalText(200),
    registrationNumber: optionalText(100),
    taxId: optionalText(100),
    phone: phoneSchema,
    website: z.union([z.url().max(300), z.literal('')]).optional().transform((v) => (v ? v : undefined)),
    category: z.string().trim().min(1).max(100),
  })
  .partial();

export const storefrontUpdateSchema = z
  .object({
    slug: slugSchema,
    displayName: z.string().trim().min(2).max(100),
    description: z.string().trim().max(2000),
    shippingOrigin: z.string().trim().max(100),
    returnPolicy: z.string().trim().max(4000),
    storePolicies: z.string().trim().max(4000),
    /** Who pays the IIE fee on this store's orders; null means the platform default. */
    feePayer: z.enum(FEE_PAYERS).nullable(),
  })
  .partial();
export type StorefrontUpdateInput = z.infer<typeof storefrontUpdateSchema>;

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: slugSchema,
  parentSlug: slugSchema.optional(),
  sortOrder: z.number().int().min(0).max(10000).default(0),
});
export const categoryUpdateSchema = z
  .object({ name: z.string().trim().min(2).max(80), sortOrder: z.number().int().min(0).max(10000), active: z.boolean() })
  .partial();

const dimension = z.number().int().min(1).max(10_000_000);
export const variantInputSchema = z.object({
  sku: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/, 'Letters, numbers, dots, dashes and underscores only'),
  name: z.string().trim().min(1).max(100),
  price: priceInputSchema,
  quantity: z.number().int().min(0).max(1_000_000).default(0),
});
export type VariantInput = z.infer<typeof variantInputSchema>;

/** Product fields without defaults, so partial updates never fill in values the caller did not send. */
const productFieldsSchema = z.object({
  title: z.string().trim().min(3).max(150),
  shortDescription: z.string().trim().min(1).max(300),
  description: z.string().trim().max(10_000),
  categorySlug: slugSchema,
  brand: optionalText(100),
  hsCode: hsCodeSchema.optional(),
  countryOfOrigin: countryCodeSchema,
  weightGrams: dimension.optional(),
  lengthMm: dimension.optional(),
  widthMm: dimension.optional(),
  heightMm: dimension.optional(),
  attributes: z.record(z.string().max(50), z.string().max(200)),
});

export const productCreateSchema = productFieldsSchema.extend({
  description: productFieldsSchema.shape.description.default(''),
  attributes: productFieldsSchema.shape.attributes.default({}),
  variants: z.array(variantInputSchema).min(1).max(50),
});
export type ProductCreateInput = z.infer<typeof productCreateSchema>;

/** Content fields: changing any of these on a live product sends it back to review. */
export const PRODUCT_CONTENT_FIELDS = ['title', 'shortDescription', 'description', 'categorySlug', 'brand', 'hsCode', 'countryOfOrigin', 'attributes'] as const;

export const productUpdateSchema = productFieldsSchema.partial();
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

export const variantUpdateSchema = z.object({ name: z.string().trim().min(1).max(100), price: priceInputSchema }).partial();
export const inventoryAdjustSchema = z.object({
  /** Set the on-hand quantity to this value (a stock count). */
  quantity: z.number().int().min(0).max(1_000_000),
  note: optionalText(200),
});

export const reviewDecisionSchema = z
  .object({ decision: z.enum(['APPROVE', 'REJECT', 'REQUEST_CHANGES']), notes: optionalText(2000) })
  .refine((v) => v.decision === 'APPROVE' || (v.notes?.length ?? 0) >= 3, {
    message: 'Explain what needs to change (at least 3 characters)',
    path: ['notes'],
  });
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

export const payoutSetupSchema = z.object({
  /** Pilot: how payouts were arranged (no bank details here; those live with the payment partner from Phase 4). */
  note: z.string().trim().min(3).max(500),
});

export const productSearchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: slugSchema.optional(),
  seller: slugSchema.optional(),
  sellerCountry: countryCodeSchema.optional(),
  destination: countryCodeSchema.optional(),
  countryOfOrigin: countryCodeSchema.optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  minPrice: priceInputSchema.optional(),
  maxPrice: priceInputSchema.optional(),
  inStock: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  sort: z.enum(['relevance', 'newest', 'price_asc', 'price_desc']).default('relevance'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
});
export type ProductSearchInput = z.infer<typeof productSearchSchema>;

export const adminProductQuerySchema = z.object({
  status: z.enum(PRODUCT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const cartAddSchema = z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(MAX_CART_QUANTITY) });
export const cartUpdateSchema = z.object({ quantity: z.number().int().min(1).max(MAX_CART_QUANTITY) });

export const addressCreateSchema = addressSchema.extend({ label: optionalText(50), makeDefault: z.boolean().default(false) });

// ------------------------------------------------------------------ Phase 3: checkout and transactions

/** A percentage typed as a decimal, e.g. "5" or "16.5". Stored as basis points (5% = 500). */
export const percentInputSchema = z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, 'Enter a percentage like 5 or 16.5');

export const checkoutQuoteSchema = z.object({ sellerSlug: slugSchema, addressId: z.uuid() });
export const placeOrderSchema = z.object({ quoteId: z.uuid() });
export const cancelOrderSchema = z.object({ reason: optionalText(500) });

export const shippingRateSchema = z.object({
  origin: countryCodeSchema,
  destination: countryCodeSchema,
  serviceName: z.string().trim().min(2).max(80),
  maxWeightGrams: z.number().int().min(1).max(1_000_000),
  price: priceInputSchema,
  isPlaceholder: z.boolean().default(false),
  active: z.boolean().default(true),
});
export const shippingRateUpdateSchema = z
  .object({ serviceName: z.string().trim().min(2).max(80), maxWeightGrams: z.number().int().min(1).max(1_000_000), price: priceInputSchema, isPlaceholder: z.boolean(), active: z.boolean() })
  .partial();

export const feeRuleUpdateSchema = z.object({ percent: percentInputSchema, defaultPayer: z.enum(FEE_PAYERS) }).partial();

export const dutyEstimateSchema = z.object({
  destination: countryCodeSchema,
  /** Leading HS digits this estimate covers; empty covers every product. The longest match wins. */
  hsPrefix: z.string().trim().regex(/^\d{0,10}$/, 'Digits only').default(''),
  caricomOriginDutyPercent: percentInputSchema,
  otherOriginDutyPercent: percentInputSchema,
  vatPercent: percentInputSchema,
  notes: z.string().trim().max(500).default(''),
  isPlaceholder: z.boolean().default(true),
});
export const dutyEstimateUpdateSchema = z
  .object({
    caricomOriginDutyPercent: percentInputSchema,
    otherOriginDutyPercent: percentInputSchema,
    vatPercent: percentInputSchema,
    notes: z.string().trim().max(500),
    isPlaceholder: z.boolean(),
  })
  .partial();

export const adminTransactionQuerySchema = z.object({
  status: z.enum(TRANSACTION_STATUSES).optional(),
  q: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// ------------------------------------------------------------------ Phase 4: payments

export const declineSaleSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const sandboxOutcomeSchema = z.object({ outcome: z.enum(['SUCCEED', 'DECLINE', 'PROCESSING']), token: z.string().min(20).max(200) });
export const exchangeRateSchema = z.object({
  base: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  quote: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  /** Units of `quote` per 1 `base`, e.g. "2.70". */
  rate: z.string().trim().regex(/^\d{1,9}(\.\d{1,8})?$/),
  source: z.string().trim().min(2).max(60),
});

// ------------------------------------------------------------------ Phase 5: logistics

const noteSchema = z.string().trim().max(500).optional();
const locationSchema = z.string().trim().max(120).optional();
const gramsSchema = z.coerce.number().int().min(1).max(1_000_000);

export const partnerCreateSchema = z.object({
  kind: z.enum(PARTNER_KINDS),
  name: z.string().trim().min(2).max(120),
  /** Home country. A customs broker clears customs in this country. */
  countryCode: countryCodeSchema,
  contactEmail: emailSchema,
  contactPhone: phoneSchema,
  /** Logistics partners only: true if they clear customs themselves; otherwise the destination's broker does. */
  clearsCustoms: z.boolean().default(false),
});
export const partnerUpdateSchema = z
  .object({ name: z.string().trim().min(2).max(120), contactEmail: emailSchema, contactPhone: phoneSchema, clearsCustoms: z.boolean(), active: z.boolean() })
  .partial();
export const partnerLaneSchema = z.object({ origin: countryCodeSchema, destination: countryCodeSchema });
export const partnerMemberInviteSchema = z.object({
  email: emailSchema,
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
});
export const shipmentAssignSchema = z.object({
  logisticsPartnerId: z.uuid().nullable().optional(),
  customsBrokerId: z.uuid().nullable().optional(),
});

/** Seller: the parcel is packed and can be collected. */
export const readyForPickupSchema = z.object({
  /** Packed weight; defaults to the weight declared at checkout. */
  parcelWeightGrams: gramsSchema.optional(),
  pickupNotes: noteSchema,
});

export const SHIPMENT_STEPS = [
  'SCHEDULE_PICKUP',
  'PICKED_UP',
  'EXPORT_PROCESSING',
  'IN_TRANSIT',
  'ARRIVED_DESTINATION',
  'CUSTOMS_PROCESSING',
  'CUSTOMS_CLEARED',
  'CUSTOMS_HOLD',
  'CUSTOMS_RELEASED',
  'OUT_FOR_DELIVERY',
] as const;
export type ShipmentStep = (typeof SHIPMENT_STEPS)[number];

/** One tracking update from a logistics partner or customs broker. Delivery has its own form (proof of delivery). */
export const shipmentStepSchema = z
  .object({
    step: z.enum(SHIPMENT_STEPS),
    note: noteSchema,
    location: locationSchema,
    /** SCHEDULE_PICKUP: ISO 8601 date-time */
    pickupAt: z.iso.datetime({ offset: true }).optional(),
    /** PICKED_UP: weight measured at pickup */
    actualWeightGrams: gramsSchema.optional(),
    /** Partner's own reference (waybill, manifest) */
    trackingReference: z.string().trim().max(60).optional(),
    /** CUSTOMS_CLEARED */
    customsEntryNumber: z.string().trim().max(60).optional(),
    /** CUSTOMS_CLEARED: duties and taxes customs assessed, paid by the buyer on arrival, e.g. "23.20" */
    dutiesAssessed: priceInputSchema.optional(),
    /** CUSTOMS_HOLD */
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.step === 'SCHEDULE_PICKUP' && !v.pickupAt) ctx.addIssue({ code: 'custom', path: ['pickupAt'], message: 'Choose the pickup date and time' });
    if (v.step === 'PICKED_UP' && !v.actualWeightGrams) ctx.addIssue({ code: 'custom', path: ['actualWeightGrams'], message: 'Enter the weight measured at pickup' });
    if (v.step === 'CUSTOMS_HOLD' && !v.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Say why customs is holding the parcel' });
  });

/** Proof of delivery. Recipient name and time are required; photo and signature are optional uploads. */
export const deliveryProofSchema = z.object({
  recipientName: z.string().trim().min(2).max(120),
  /** ISO 8601 date-time */
  deliveredAt: z.iso.datetime({ offset: true }),
  note: noteSchema,
});

export const reportProblemSchema = z.object({ reason: z.string().trim().min(10).max(1000) });
