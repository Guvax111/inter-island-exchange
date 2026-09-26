import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  addressCreateSchema,
  adminProductQuerySchema,
  adminUserQuerySchema,
  cartAddSchema,
  cartUpdateSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  inventoryAdjustSchema,
  payoutSetupSchema,
  productCreateSchema,
  productSearchSchema,
  productUpdateSchema,
  reviewDecisionSchema,
  sellerProfileUpdateSchema,
  storefrontUpdateSchema,
  variantInputSchema,
  variantUpdateSchema,
  auditQuerySchema,
  buyerOnboardingSchema,
  changePasswordSchema,
  countryCreateSchema,
  countryUpdateSchema,
  emailOnlySchema,
  grantRoleSchema,
  loginSchema,
  passwordConfirmSchema,
  reasonSchema,
  registerSchema,
  resetPasswordSchema,
  sellerOnboardingSchema,
  tokenSchema,
  totpCodeSchema,
} from '@iie/shared';

// Request bodies are validated by the global ZodValidationPipe using the schemas shared with the web app.
export class RegisterDto extends createZodDto(registerSchema) {}
export class LoginDto extends createZodDto(loginSchema) {}
export class TokenDto extends createZodDto(tokenSchema) {}
export class EmailDto extends createZodDto(emailOnlySchema) {}
export class ResetPasswordDto extends createZodDto(resetPasswordSchema) {}
export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}
export class TotpCodeDto extends createZodDto(totpCodeSchema) {}
export class PasswordConfirmDto extends createZodDto(passwordConfirmSchema) {}
export class OnboardingDto extends createZodDto(
  z
    .object({ buyer: buyerOnboardingSchema.optional(), seller: sellerOnboardingSchema.optional() })
    .refine((v) => v.buyer || v.seller, { message: 'Provide buyer and/or seller details' }),
) {}
export class UpdateMeDto extends createZodDto(
  z.object({ firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100) }).partial(),
) {}
export class CountryCreateDto extends createZodDto(countryCreateSchema) {}
export class CountryUpdateDto extends createZodDto(countryUpdateSchema) {}
export class LaneDto extends createZodDto(
  z.object({ origin: z.string().regex(/^[A-Z]{2}$/), destination: z.string().regex(/^[A-Z]{2}$/), enabled: z.boolean() }),
) {}
export class ReasonDto extends createZodDto(reasonSchema) {}
export class GrantRoleDto extends createZodDto(grantRoleSchema) {}
export class AdminUserQueryDto extends createZodDto(adminUserQuerySchema) {}
export class AuditQueryDto extends createZodDto(auditQuerySchema) {}

// Phase 2
export class SellerProfileUpdateDto extends createZodDto(sellerProfileUpdateSchema) {}
export class StorefrontUpdateDto extends createZodDto(storefrontUpdateSchema) {}
export class CategoryCreateDto extends createZodDto(categoryCreateSchema) {}
export class CategoryUpdateDto extends createZodDto(categoryUpdateSchema) {}
export class ProductCreateDto extends createZodDto(productCreateSchema) {}
export class ProductUpdateDto extends createZodDto(productUpdateSchema) {}
export class VariantCreateDto extends createZodDto(variantInputSchema) {}
export class VariantUpdateDto extends createZodDto(variantUpdateSchema) {}
export class InventoryAdjustDto extends createZodDto(inventoryAdjustSchema) {}
export class ReviewDecisionDto extends createZodDto(reviewDecisionSchema) {}
export class PayoutSetupDto extends createZodDto(payoutSetupSchema) {}
export class ProductSearchDto extends createZodDto(productSearchSchema) {}
export class AdminProductQueryDto extends createZodDto(adminProductQuerySchema) {}
export class AdminSellerQueryDto extends createZodDto(
  z.object({
    status: z.enum(['DRAFT', 'PENDING_VERIFICATION', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'REJECTED']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  }),
) {}
export class CartAddDto extends createZodDto(cartAddSchema) {}
export class CartUpdateDto extends createZodDto(cartUpdateSchema) {}
export class AddressCreateDto extends createZodDto(addressCreateSchema) {}
export class ImageUploadDto extends createZodDto(z.object({ altText: z.string().trim().max(200).optional() })) {}
export class SellerQueryDto extends createZodDto(z.object({ country: z.string().regex(/^[A-Z]{2}$/).optional() })) {}
