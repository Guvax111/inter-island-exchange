import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { AddressInput, BuyerOnboardingInput, SellerOnboardingInput } from '@iie/shared';
import { Database, DB, Tx } from '../db/db';
import {
  accountDeletionRequests,
  addresses,
  businesses,
  buyerProfiles,
  countries,
  currencies,
  mfaFactors,
  sellerProfiles,
  sellerStorefronts,
  users,
} from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { AppError, Errors } from '../common/errors';
import type { RequestMeta } from '../common/request';
import type { Principal } from '../rbac/principal';
import { AccountLifecycleService } from '../users/account-lifecycle.service';
import { verifyPassword } from '../auth/passwords';

export type NextAction = 'VERIFY_EMAIL' | 'COMPLETE_ONBOARDING' | 'ACCOUNT_UNDER_REVIEW' | 'SELLER_UNDER_REVIEW' | 'NONE';

@Injectable()
export class ProfilesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly lifecycle: AccountLifecycleService,
  ) {}

  async getMe(principal: Principal) {
    const [row] = await this.db
      .select({ user: users, country: countries, currency: currencies })
      .from(users)
      .innerJoin(countries, eq(countries.id, users.countryId))
      .innerJoin(currencies, eq(currencies.code, countries.currencyCode))
      .where(eq(users.id, principal.userId));
    if (!row) throw Errors.notFound('User');
    const [buyer] = await this.db.select().from(buyerProfiles).where(eq(buyerProfiles.userId, principal.userId));
    const [seller] = await this.db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, principal.userId));
    const [storefront] = seller
      ? await this.db.select({ slug: sellerStorefronts.slug }).from(sellerStorefronts).where(eq(sellerStorefronts.sellerProfileId, seller.id))
      : [];
    const [mfa] = await this.db.select({ confirmedAt: mfaFactors.confirmedAt }).from(mfaFactors).where(eq(mfaFactors.userId, principal.userId));
    const userAddresses = await this.db.select().from(addresses).where(eq(addresses.userId, principal.userId));
    const { user, country, currency } = row;

    let nextAction: NextAction = 'NONE';
    if (!user.emailVerifiedAt) nextAction = 'VERIFY_EMAIL';
    else if (!user.onboardingSubmittedAt) nextAction = 'COMPLETE_ONBOARDING';
    else if (user.status === 'UNDER_REVIEW') nextAction = 'ACCOUNT_UNDER_REVIEW';
    else if (seller?.status === 'UNDER_REVIEW') nextAction = 'SELLER_UNDER_REVIEW';

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        status: user.status,
        emailVerified: !!user.emailVerifiedAt,
        onboardingSubmitted: !!user.onboardingSubmittedAt,
        country: { code: country.isoAlpha2, name: country.name, currency: { code: currency.code, symbol: currency.symbol } },
        createdAt: user.createdAt,
      },
      roles: principal.roles.map((r) => r.key),
      permissions: principal.permissionKeys(),
      mfaEnabled: !!mfa?.confirmedAt,
      buyerProfile: buyer ? { partyType: buyer.partyType, verificationLevel: buyer.verificationLevel } : null,
      sellerProfile: seller
        ? {
            id: seller.id,
            partyType: seller.partyType,
            legalName: seller.legalName,
            category: seller.category,
            status: seller.status,
            storefrontSlug: storefront?.slug ?? null,
          }
        : null,
      addresses: userAddresses.map(({ userId: _u, ...a }) => a),
      nextAction,
      csrfToken: principal.csrfToken,
    };
  }

  async updateMe(principal: Principal, patch: { firstName?: string; lastName?: string }, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select({ firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(eq(users.id, principal.userId));
      await tx.update(users).set({ ...patch, updatedAt: new Date() }).where(eq(users.id, principal.userId));
      await this.audit.record(tx, meta, { action: 'user.profile_updated', entityType: 'user', entityId: principal.userId, before, after: patch });
    });
  }

  /**
   * One-time onboarding submission. Buyer details are required for buyers and seller details for sellers.
   * After submission the account moves to PENDING_VERIFICATION or ACTIVE (see AccountLifecycleService);
   * seller profiles wait in UNDER_REVIEW for an administrator.
   */
  async submitOnboarding(
    principal: Principal,
    input: { buyer?: BuyerOnboardingInput; seller?: SellerOnboardingInput },
    meta: RequestMeta,
  ): Promise<void> {
    const isBuyer = principal.hasRole('buyer');
    const isSeller = principal.hasRole('seller');
    if (isBuyer !== !!input.buyer || isSeller !== !!input.seller) {
      throw Errors.badRequest(
        'ONBOARDING_MISMATCH',
        `Provide ${[isBuyer && 'buyer', isSeller && 'seller'].filter(Boolean).join(' and ')} details for this account`,
      );
    }

    await this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, principal.userId)).for('update');
      if (!user) throw Errors.notFound('User');
      if (user.onboardingSubmittedAt) throw Errors.conflict('ONBOARDING_ALREADY_SUBMITTED', 'Onboarding has already been submitted');

      if (input.buyer) {
        const b = input.buyer;
        const addressId = await this.insertAddress(tx, user.id, user.countryId, b.address, 'Delivery');
        const businessId = b.partyType === 'BUSINESS' ? await this.insertBusiness(tx, user.countryId, { legalName: b.businessName! }) : null;
        await tx.insert(buyerProfiles).values({ userId: user.id, partyType: b.partyType, businessId, defaultAddressId: addressId });
        await tx
          .update(users)
          .set({ firstName: b.firstName, lastName: b.lastName, phone: b.phone, updatedAt: new Date() })
          .where(eq(users.id, user.id));
      }

      if (input.seller) {
        const s = input.seller;
        const addressId = await this.insertAddress(tx, user.id, user.countryId, s.address, 'Business');
        const businessId =
          s.partyType === 'BUSINESS'
            ? await this.insertBusiness(tx, user.countryId, {
                legalName: s.legalName,
                tradingName: s.businessName,
                registrationNumber: s.registrationNumber,
                taxId: s.taxId,
                website: s.website,
              })
            : null;
        await tx.insert(sellerProfiles).values({
          userId: user.id,
          partyType: s.partyType,
          legalName: s.legalName,
          businessId,
          phone: s.phone,
          website: s.website ?? null,
          category: s.category,
          countryId: user.countryId,
          addressId,
          submittedAt: new Date(),
        });
        if (!input.buyer) await tx.update(users).set({ phone: s.phone, updatedAt: new Date() }).where(eq(users.id, user.id));
      }

      await tx.update(users).set({ onboardingSubmittedAt: new Date() }).where(eq(users.id, user.id));
      await this.audit.record(tx, meta, {
        action: 'user.onboarding_submitted',
        entityType: 'user',
        entityId: user.id,
        after: {
          buyer: input.buyer ? { partyType: input.buyer.partyType } : undefined,
          seller: input.seller ? { partyType: input.seller.partyType, category: input.seller.category } : undefined,
        },
      });
      await this.lifecycle.advance(tx, user.id, meta);
    });
  }

  async requestDeletion(principal: Principal, password: string, reason: string | undefined, meta: RequestMeta) {
    const [user] = await this.db.select().from(users).where(eq(users.id, principal.userId));
    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'INVALID_CURRENT_PASSWORD', 'Your password is incorrect');
    }
    await this.db.transaction(async (tx) => {
      const [open] = await tx
        .select()
        .from(accountDeletionRequests)
        .where(and(eq(accountDeletionRequests.userId, user.id), eq(accountDeletionRequests.status, 'REQUESTED')));
      if (open) return;
      const [created] = await tx.insert(accountDeletionRequests).values({ userId: user.id, reason: reason ?? null }).returning();
      await this.audit.record(tx, meta, { action: 'user.deletion_requested', entityType: 'account_deletion_request', entityId: created!.id });
    });
  }

  private async insertAddress(tx: Tx, userId: string, userCountryId: string, address: AddressInput, label: string) {
    const [country] = await tx.select().from(countries).where(eq(countries.isoAlpha2, address.countryCode));
    if (!country || country.id !== userCountryId) {
      throw Errors.badRequest('ADDRESS_COUNTRY_MISMATCH', 'The address must be in the country you registered in');
    }
    const [row] = await tx
      .insert(addresses)
      .values({
        userId,
        label,
        line1: address.line1,
        line2: address.line2 ?? null,
        city: address.city,
        region: address.region ?? null,
        postalCode: address.postalCode ?? null,
        countryId: country.id,
      })
      .returning({ id: addresses.id });
    return row!.id;
  }

  private async insertBusiness(
    tx: Tx,
    countryId: string,
    b: { legalName: string; tradingName?: string; registrationNumber?: string; taxId?: string; website?: string },
  ) {
    const [row] = await tx
      .insert(businesses)
      .values({
        legalName: b.legalName,
        tradingName: b.tradingName ?? null,
        registrationNumber: b.registrationNumber ?? null,
        taxId: b.taxId ?? null,
        website: b.website ?? null,
        countryId,
      })
      .onConflictDoNothing()
      .returning({ id: businesses.id });
    if (!row) throw Errors.conflict('BUSINESS_ALREADY_REGISTERED', 'A business with this registration number is already registered');
    return row.id;
  }
}
