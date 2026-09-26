import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  adminUserQuerySchema,
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
