import { z } from 'zod';
import { ACCOUNT_STATUSES, ACCOUNT_TYPES, PARTY_TYPES } from './statuses';
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
