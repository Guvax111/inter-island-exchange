import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, like, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { ReviewDecision, StorefrontUpdateInput, sellerProfileUpdateSchema } from '@iie/shared';
import { Database, DB, Tx } from '../db/db';
import { businesses, countries, products, sellerProfiles, sellerStorefronts, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { EVENTS } from '../email/notification.dispatcher';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request';
import { slugify } from '../common/slug';
import type { Principal } from '../rbac/principal';
import { MediaService } from '../media/media.service';

type SellerRow = typeof sellerProfiles.$inferSelect;
const EDITABLE_STOREFRONT_STATUSES = ['APPROVED', 'ACTIVE'];

/**
 * Seller lifecycle after onboarding:
 *   UNDER_REVIEW --approve--> APPROVED --payout setup confirmed--> ACTIVE
 *   UNDER_REVIEW --request changes--> DRAFT --seller resubmits--> UNDER_REVIEW
 *   UNDER_REVIEW --reject--> REJECTED
 *   ACTIVE <--suspend / reinstate--> SUSPENDED
 */
@Injectable()
export class SellersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly media: MediaService,
  ) {}

  // ------------------------------------------------------------------ seller self-service

  async mySeller(principal: Principal) {
    const seller = await this.requireOwnSeller(principal);
    const [storefront] = await this.db.select().from(sellerStorefronts).where(eq(sellerStorefronts.sellerProfileId, seller.id));
    const counts = await this.db
      .select({ status: products.status, count: sql<number>`count(*)::int` })
      .from(products)
      .where(eq(products.sellerProfileId, seller.id))
      .groupBy(products.status);
    const [business] = seller.businessId ? await this.db.select().from(businesses).where(eq(businesses.id, seller.businessId)) : [];
    return {
      profile: {
        id: seller.id,
        status: seller.status,
        partyType: seller.partyType,
        legalName: seller.legalName,
        businessName: business?.tradingName ?? null,
        registrationNumber: business?.registrationNumber ?? null,
        taxId: business?.taxId ?? null,
        phone: seller.phone,
        website: seller.website,
        category: seller.category,
        reviewNotes: seller.status === 'DRAFT' || seller.status === 'REJECTED' ? seller.reviewNotes : null,
        payoutSetupConfirmed: !!seller.payoutSetupConfirmedAt,
      },
      storefront: storefront ? this.storefrontDto(storefront) : null,
      productCounts: Object.fromEntries(counts.map((c) => [c.status, c.count])),
    };
  }

  /** Editing is allowed while the application is a draft (e.g. after the reviewer asked for changes). */
  async updateMySellerProfile(principal: Principal, patch: z.infer<typeof sellerProfileUpdateSchema>, meta: RequestMeta) {
    const seller = await this.requireOwnSeller(principal);
    if (seller.status !== 'DRAFT') throw Errors.conflict('SELLER_NOT_EDITABLE', 'Your seller details can only be changed while the application is open for changes');
    await this.db.transaction(async (tx) => {
      const { businessName, registrationNumber, taxId, website, ...profileFields } = patch;
      await tx
        .update(sellerProfiles)
        .set({ ...profileFields, ...(website !== undefined ? { website } : {}), updatedAt: new Date() })
        .where(eq(sellerProfiles.id, seller.id));
      if (seller.businessId && (businessName !== undefined || registrationNumber !== undefined || taxId !== undefined || website !== undefined || patch.legalName)) {
        await tx
          .update(businesses)
          .set({
            ...(patch.legalName ? { legalName: patch.legalName } : {}),
            ...(businessName !== undefined ? { tradingName: businessName } : {}),
            ...(registrationNumber !== undefined ? { registrationNumber } : {}),
            ...(taxId !== undefined ? { taxId } : {}),
            ...(website !== undefined ? { website } : {}),
            updatedAt: new Date(),
          })
          .where(eq(businesses.id, seller.businessId));
      }
      await this.audit.record(tx, meta, { action: 'seller.profile_updated', entityType: 'seller_profile', entityId: seller.id, after: patch });
    });
  }

  async resubmit(principal: Principal, meta: RequestMeta) {
    const seller = await this.requireOwnSeller(principal);
    if (seller.status !== 'DRAFT' || !seller.submittedAt) throw Errors.conflict('SELLER_NOT_RESUBMITTABLE', 'There is no returned application to resubmit');
    const [user] = await this.db.select().from(users).where(eq(users.id, principal.userId));
    if (!user?.emailVerifiedAt) throw Errors.conflict('EMAIL_NOT_VERIFIED', 'Confirm your email address first');
    await this.db.transaction(async (tx) => {
      await tx.update(sellerProfiles).set({ status: 'UNDER_REVIEW', submittedAt: new Date(), updatedAt: new Date() }).where(eq(sellerProfiles.id, seller.id));
      await this.audit.record(tx, meta, { action: 'seller.resubmitted', entityType: 'seller_profile', entityId: seller.id, before: { status: 'DRAFT' }, after: { status: 'UNDER_REVIEW' } });
    });
  }

  async updateStorefront(principal: Principal, patch: StorefrontUpdateInput, meta: RequestMeta) {
    const seller = await this.requireOwnSeller(principal);
    if (!EDITABLE_STOREFRONT_STATUSES.includes(seller.status)) throw Errors.conflict('STOREFRONT_NOT_AVAILABLE', 'Your storefront opens once your seller application is approved');
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(sellerStorefronts).where(eq(sellerStorefronts.sellerProfileId, seller.id));
      if (!before) throw Errors.notFound('Storefront');
      const [updated] = await tx
        .update(sellerStorefronts)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(sellerStorefronts.id, before.id))
        .returning()
        .catch((err: { code?: string; cause?: { code?: string } }) => {
          if ((err.cause?.code ?? err.code) === '23505') throw Errors.conflict('SLUG_TAKEN', 'That store web address is already taken');
          throw err;
        });
      const changed = Object.keys(patch) as (keyof StorefrontUpdateInput)[];
      await this.audit.record(tx, meta, {
        action: 'storefront.updated',
        entityType: 'storefront',
        entityId: before.id,
        before: Object.fromEntries(changed.map((k) => [k, before[k]])),
        after: patch,
      });
      return this.storefrontDto(updated!);
    });
  }

  async setLogo(principal: Principal, file: Express.Multer.File | undefined, meta: RequestMeta) {
    const seller = await this.requireOwnSeller(principal);
    if (!EDITABLE_STOREFRONT_STATUSES.includes(seller.status)) throw Errors.conflict('STOREFRONT_NOT_AVAILABLE', 'Your storefront opens once your seller application is approved');
    const { logoUrl, oldFile } = await this.db.transaction(async (tx) => {
      const [storefront] = await tx.select().from(sellerStorefronts).where(eq(sellerStorefronts.sellerProfileId, seller.id)).for('update');
      if (!storefront) throw Errors.notFound('Storefront');
      const asset = await this.media.storeImage(tx, principal.userId, 'STORE_LOGO', file);
      await tx.update(sellerStorefronts).set({ logoMediaId: asset.id, updatedAt: new Date() }).where(eq(sellerStorefronts.id, storefront.id));
      const oldFile = storefront.logoMediaId ? await this.media.detach(tx, storefront.logoMediaId) : null;
      await this.audit.record(tx, meta, { action: 'storefront.logo_updated', entityType: 'storefront', entityId: storefront.id, after: { mediaId: asset.id } });
      return { logoUrl: `/api/v1/media/${asset.id}`, oldFile };
    });
    await this.media.deleteFile(oldFile);
    return { logoUrl };
  }

  // ------------------------------------------------------------------ administration

  async listForReview(principal: Principal, status: string | undefined, page: number, pageSize: number) {
    const scope = principal.scopeOf('seller.review');
    if (!scope) throw Errors.forbidden();
    const where = and(
      scope === 'ALL' ? undefined : inArray(sellerProfiles.countryId, [...scope]),
      status ? eq(sellerProfiles.status, status) : undefined,
    );
    const rows = await this.db
      .select({
        id: sellerProfiles.id,
        legalName: sellerProfiles.legalName,
        partyType: sellerProfiles.partyType,
        category: sellerProfiles.category,
        status: sellerProfiles.status,
        submittedAt: sellerProfiles.submittedAt,
        country: countries.isoAlpha2,
        email: users.email,
      })
      .from(sellerProfiles)
      .innerJoin(users, eq(users.id, sellerProfiles.userId))
      .innerJoin(countries, eq(countries.id, sellerProfiles.countryId))
      .where(where)
      .orderBy(desc(sellerProfiles.submittedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [total] = await this.db.select({ count: sql<number>`count(*)::int` }).from(sellerProfiles).where(where);
    return { items: rows, total: total?.count ?? 0, page, pageSize };
  }

  async getForReview(principal: Principal, sellerId: string) {
    const seller = await this.loadInScope(principal, sellerId);
    const [user] = await this.db
      .select({ id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName, status: users.status, emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, seller.userId));
    const [business] = seller.businessId ? await this.db.select().from(businesses).where(eq(businesses.id, seller.businessId)) : [];
    const [storefront] = await this.db.select().from(sellerStorefronts).where(eq(sellerStorefronts.sellerProfileId, seller.id));
    return { seller, user, business: business ?? null, storefront: storefront ? this.storefrontDto(storefront) : null };
  }

  async review(principal: Principal, sellerId: string, decision: ReviewDecision, meta: RequestMeta) {
    const seller = await this.loadInScope(principal, sellerId);
    if (seller.userId === principal.userId) throw Errors.forbidden('You cannot review your own seller application');
    if (seller.status !== 'UNDER_REVIEW') throw Errors.conflict('NOT_UNDER_REVIEW', 'This application is not waiting for review');
    const next = { APPROVE: 'APPROVED', REJECT: 'REJECTED', REQUEST_CHANGES: 'DRAFT' }[decision.decision];
    const event = { APPROVE: EVENTS.sellerApproved, REJECT: EVENTS.sellerRejected, REQUEST_CHANGES: EVENTS.sellerChangesRequested }[decision.decision];

    await this.db.transaction(async (tx) => {
      await tx
        .update(sellerProfiles)
        .set({ status: next, reviewedAt: new Date(), reviewedBy: principal.userId, reviewNotes: decision.notes ?? null, updatedAt: new Date() })
        .where(eq(sellerProfiles.id, seller.id));
      if (decision.decision === 'APPROVE') await this.ensureStorefront(tx, seller);
      await this.notifySeller(tx, seller, event, decision.notes);
      await this.audit.record(tx, meta, {
        action: `seller.review.${decision.decision.toLowerCase()}`,
        entityType: 'seller_profile',
        entityId: seller.id,
        before: { status: seller.status },
        after: { status: next, notes: decision.notes ?? null },
      });
    });
  }

  /** Pilot: payouts are arranged outside IIE until the payment partner integration, so staff confirm it here. */
  async confirmPayoutSetup(principal: Principal, sellerId: string, note: string, meta: RequestMeta) {
    const seller = await this.loadInScope(principal, sellerId);
    if (seller.status !== 'APPROVED') throw Errors.conflict('NOT_APPROVED', 'Only approved sellers can be activated');
    await this.db.transaction(async (tx) => {
      await tx
        .update(sellerProfiles)
        .set({ status: 'ACTIVE', payoutSetupConfirmedAt: new Date(), payoutSetupConfirmedBy: principal.userId, payoutSetupNote: note, updatedAt: new Date() })
        .where(eq(sellerProfiles.id, seller.id));
      await this.notifySeller(tx, seller, EVENTS.sellerActivated);
      await this.audit.record(tx, meta, { action: 'seller.activated', entityType: 'seller_profile', entityId: seller.id, before: { status: 'APPROVED' }, after: { status: 'ACTIVE', payoutSetupNote: note } });
    });
  }

  async suspend(principal: Principal, sellerId: string, reason: string, meta: RequestMeta) {
    const seller = await this.loadInScope(principal, sellerId);
    if (!['APPROVED', 'ACTIVE'].includes(seller.status)) throw Errors.conflict('NOT_SUSPENDABLE', 'Only approved or active sellers can be suspended');
    await this.db.transaction(async (tx) => {
      await tx.update(sellerProfiles).set({ status: 'SUSPENDED', updatedAt: new Date() }).where(eq(sellerProfiles.id, seller.id));
      await this.notifySeller(tx, seller, EVENTS.sellerSuspended, reason);
      await this.audit.record(tx, meta, { action: 'seller.suspended', entityType: 'seller_profile', entityId: seller.id, before: { status: seller.status }, after: { status: 'SUSPENDED', reason } });
    });
  }

  async reinstate(principal: Principal, sellerId: string, reason: string, meta: RequestMeta) {
    const seller = await this.loadInScope(principal, sellerId);
    if (seller.status !== 'SUSPENDED') throw Errors.conflict('NOT_SUSPENDED', 'This seller is not suspended');
    const next = seller.payoutSetupConfirmedAt ? 'ACTIVE' : 'APPROVED';
    await this.db.transaction(async (tx) => {
      await tx.update(sellerProfiles).set({ status: next, updatedAt: new Date() }).where(eq(sellerProfiles.id, seller.id));
      await this.audit.record(tx, meta, { action: 'seller.reinstated', entityType: 'seller_profile', entityId: seller.id, before: { status: 'SUSPENDED' }, after: { status: next, reason } });
    });
  }

  // ------------------------------------------------------------------ helpers

  async requireOwnSeller(principal: Principal): Promise<SellerRow> {
    const [seller] = await this.db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, principal.userId));
    if (!seller) throw Errors.notFound('Seller profile');
    return seller;
  }

  private async loadInScope(principal: Principal, sellerId: string): Promise<SellerRow> {
    const [seller] = await this.db.select().from(sellerProfiles).where(eq(sellerProfiles.id, sellerId));
    if (!seller || !principal.canInCountry('seller.review', seller.countryId)) throw Errors.notFound('Seller');
    return seller;
  }

  private async ensureStorefront(tx: Tx, seller: SellerRow) {
    const [existing] = await tx.select().from(sellerStorefronts).where(eq(sellerStorefronts.sellerProfileId, seller.id));
    if (existing) return;
    const [business] = seller.businessId ? await tx.select().from(businesses).where(eq(businesses.id, seller.businessId)) : [];
    const displayName = business?.tradingName ?? seller.legalName;
    const base = slugify(displayName);
    const taken = await tx.select({ slug: sellerStorefronts.slug }).from(sellerStorefronts).where(like(sellerStorefronts.slug, `${base}%`));
    const used = new Set(taken.map((t) => t.slug));
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    await tx.insert(sellerStorefronts).values({ sellerProfileId: seller.id, slug, displayName });
  }

  private async notifySeller(tx: Tx, seller: SellerRow, event: string, notes?: string) {
    const [user] = await tx.select({ email: users.email, firstName: users.firstName }).from(users).where(eq(users.id, seller.userId));
    await this.outbox.enqueue(tx, event, { email: user!.email, firstName: user!.firstName, notes });
  }

  storefrontDto(s: typeof sellerStorefronts.$inferSelect) {
    return {
      slug: s.slug,
      displayName: s.displayName,
      description: s.description,
      logoUrl: s.logoMediaId ? `/api/v1/media/${s.logoMediaId}` : null,
      shippingOrigin: s.shippingOrigin,
      returnPolicy: s.returnPolicy,
      storePolicies: s.storePolicies,
      feePayer: s.feePayer,
    };
  }
}
