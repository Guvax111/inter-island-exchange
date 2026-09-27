import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  helpArticleSchema,
  helpArticleUpdateSchema,
  reportRecipientSchema,
  reviewModerationSchema,
  reviewSchema,
  settlementPaidSchema,
  supportMessageSchema,
  supportThreadSchema,
  addressCreateSchema,
  declineSaleSchema,
  exchangeRateSchema,
  deliveryProofSchema,
  disputeDecisionSchema,
  disputeMessageSchema,
  sellerDocumentReviewSchema,
  sellerDocumentUploadSchema,
  tariffImportSchema,
  tariffLookupSchema,
  tariffSearchSchema,
  partnerCreateSchema,
  partnerLaneSchema,
  partnerMemberInviteSchema,
  partnerUpdateSchema,
  readyForPickupSchema,
  reportProblemSchema,
  shipmentAssignSchema,
  shipmentStepSchema,
  adminTransactionQuerySchema,
  cancelOrderSchema,
  checkoutQuoteSchema,
  dutyEstimateSchema,
  dutyEstimateUpdateSchema,
  feeRuleUpdateSchema,
  placeOrderSchema,
  shippingRateSchema,
  shippingRateUpdateSchema,
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

// Phase 3
export class CheckoutQuoteDto extends createZodDto(checkoutQuoteSchema) {}
export class PlaceOrderDto extends createZodDto(placeOrderSchema) {}
export class CancelOrderDto extends createZodDto(cancelOrderSchema) {}
export class AdminTransactionQueryDto extends createZodDto(adminTransactionQuerySchema) {}
export class ShippingRateDto extends createZodDto(shippingRateSchema) {}
export class ShippingRateUpdateDto extends createZodDto(shippingRateUpdateSchema) {}
export class FeeRuleUpdateDto extends createZodDto(feeRuleUpdateSchema) {}
export class DutyEstimateDto extends createZodDto(dutyEstimateSchema) {}
export class DutyEstimateUpdateDto extends createZodDto(dutyEstimateUpdateSchema) {}
export class MarkReadDto extends createZodDto(z.object({ ids: z.array(z.uuid()).max(100).default([]) })) {}

// Phase 4
export class DeclineSaleDto extends createZodDto(declineSaleSchema) {}
export class ExchangeRateDto extends createZodDto(exchangeRateSchema) {}

// Phase 5
export class PartnerCreateDto extends createZodDto(partnerCreateSchema) {}
export class PartnerUpdateDto extends createZodDto(partnerUpdateSchema) {}
export class PartnerLaneDto extends createZodDto(partnerLaneSchema) {}
export class PartnerMemberInviteDto extends createZodDto(partnerMemberInviteSchema) {}
export class ShipmentAssignDto extends createZodDto(shipmentAssignSchema) {}
export class ReadyForPickupDto extends createZodDto(readyForPickupSchema) {}
export class ShipmentStepDto extends createZodDto(shipmentStepSchema) {}
export class DeliveryProofDto extends createZodDto(deliveryProofSchema) {}
export class ReportProblemDto extends createZodDto(reportProblemSchema) {}
export class AdminShipmentQueryDto extends createZodDto(z.object({ view: z.enum(['attention', 'all']).default('attention') })) {}

// Phase 6
export class DisputeMessageDto extends createZodDto(disputeMessageSchema) {}
export class DisputeDecisionDto extends createZodDto(disputeDecisionSchema) {}
export class SellerDocumentUploadDto extends createZodDto(sellerDocumentUploadSchema) {}
export class SellerDocumentReviewDto extends createZodDto(sellerDocumentReviewSchema) {}
export class TariffImportDto extends createZodDto(tariffImportSchema) {}
export class TariffLookupDto extends createZodDto(tariffLookupSchema) {}
export class TariffSearchDto extends createZodDto(tariffSearchSchema) {}
export class SettlementPaidDto extends createZodDto(settlementPaidSchema) {}
export class ReportRecipientDto extends createZodDto(reportRecipientSchema) {}
export class ReviewDto extends createZodDto(reviewSchema) {}
export class ReviewModerationDto extends createZodDto(reviewModerationSchema) {}
export class SupportThreadDto extends createZodDto(supportThreadSchema) {}
export class SupportMessageDto extends createZodDto(supportMessageSchema) {}
export class HelpArticleDto extends createZodDto(helpArticleSchema) {}
export class HelpArticleUpdateDto extends createZodDto(helpArticleUpdateSchema) {}
