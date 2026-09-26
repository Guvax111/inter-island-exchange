import { z } from 'zod';
import { ACCOUNT_STATUSES, ACCOUNT_TYPES, MAX_CART_QUANTITY, PARTY_TYPES, PRODUCT_STATUSES } from './statuses';
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
