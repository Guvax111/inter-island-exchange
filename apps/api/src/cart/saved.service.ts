import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { AddressInput } from '@iie/shared';
import { Database, DB } from '../db/db';
import { addresses, buyerProfiles, countries, products, savedProducts, savedSellers, sellerProfiles, sellerStorefronts } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request';
import type { Principal } from '../rbac/principal';
import { MarketplaceService } from '../marketplace/marketplace.service';

/** Buyer conveniences: saved products and sellers, and the address book. */
@Injectable()
export class SavedService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly marketplace: MarketplaceService,
    private readonly audit: AuditService,
  ) {}

  async listProducts(principal: Principal) {
    const rows = await this.db.select({ productId: savedProducts.productId }).from(savedProducts).where(eq(savedProducts.userId, principal.userId)).orderBy(desc(savedProducts.createdAt));
    // Saved items that are no longer public are shown as unavailable rather than silently dropped.
    return Promise.all(
      rows.map(async ({ productId }) => {
        try {
          const p = await this.marketplace.product(productId);
          return { id: p.id, title: p.title, imageUrl: p.images[0]?.url ?? null, priceFrom: p.variants[0]?.price ?? null, available: true, seller: p.seller };
        } catch {
          const [row] = await this.db.select({ title: products.title }).from(products).where(eq(products.id, productId));
          return { id: productId, title: row?.title ?? 'Product', imageUrl: null, priceFrom: null, available: false, seller: null };
        }
      }),
    );
  }

  async saveProduct(principal: Principal, productId: string) {
    await this.marketplace.product(productId); // only public products can be saved
    await this.db.insert(savedProducts).values({ userId: principal.userId, productId }).onConflictDoNothing();
  }

  async unsaveProduct(principal: Principal, productId: string) {
    await this.db.delete(savedProducts).where(and(eq(savedProducts.userId, principal.userId), eq(savedProducts.productId, productId)));
  }

  async listSellers(principal: Principal) {
    const rows = await this.db
      .select({ slug: sellerStorefronts.slug })
      .from(savedSellers)
      .innerJoin(sellerStorefronts, eq(sellerStorefronts.sellerProfileId, savedSellers.sellerProfileId))
      .where(eq(savedSellers.userId, principal.userId))
      .orderBy(desc(savedSellers.createdAt));
    const out = [];
    for (const { slug } of rows) {
      try {
        out.push({ ...(await this.marketplace.storefront(slug)), available: true });
      } catch {
        out.push({ slug, available: false });
      }
    }
    return out;
  }

  async saveSeller(principal: Principal, slug: string) {
    await this.marketplace.storefront(slug); // only public sellers
    const [row] = await this.db.select({ id: sellerStorefronts.sellerProfileId }).from(sellerStorefronts).where(eq(sellerStorefronts.slug, slug));
    await this.db.insert(savedSellers).values({ userId: principal.userId, sellerProfileId: row!.id }).onConflictDoNothing();
  }

  async unsaveSeller(principal: Principal, slug: string) {
    const [row] = await this.db.select({ id: sellerStorefronts.sellerProfileId }).from(sellerStorefronts).where(eq(sellerStorefronts.slug, slug));
    if (row) await this.db.delete(savedSellers).where(and(eq(savedSellers.userId, principal.userId), eq(savedSellers.sellerProfileId, row.id)));
  }

  // ------------------------------------------------------------------ addresses

  async listAddresses(principal: Principal) {
    const [buyer] = await this.db.select({ defaultAddressId: buyerProfiles.defaultAddressId }).from(buyerProfiles).where(eq(buyerProfiles.userId, principal.userId));
    const rows = await this.db
      .select({ address: addresses, country: countries.isoAlpha2 })
      .from(addresses)
      .innerJoin(countries, eq(countries.id, addresses.countryId))
      .where(eq(addresses.userId, principal.userId))
      .orderBy(desc(addresses.createdAt));
    // Business addresses belong to the seller profile and are not delivery addresses.
    const [seller] = await this.db.select({ addressId: sellerProfiles.addressId }).from(sellerProfiles).where(eq(sellerProfiles.userId, principal.userId));
    return rows
      .filter((r) => r.address.id !== seller?.addressId)
      .map(({ address: { userId: _u, countryId: _c, ...a }, country }) => ({ ...a, countryCode: country, isDefault: a.id === buyer?.defaultAddressId }));
  }

  /** Pilot rule: delivery addresses are in the buyer's registered country. */
  async addAddress(principal: Principal, input: AddressInput & { label?: string; makeDefault: boolean }, meta: RequestMeta) {
    const [country] = await this.db.select().from(countries).where(eq(countries.isoAlpha2, input.countryCode));
    if (!country || country.id !== principal.countryId) throw Errors.badRequest('ADDRESS_COUNTRY_MISMATCH', 'Delivery addresses must be in the country you registered in');
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(addresses)
        .values({ userId: principal.userId, label: input.label ?? null, line1: input.line1, line2: input.line2 ?? null, city: input.city, region: input.region ?? null, postalCode: input.postalCode ?? null, countryId: country.id })
        .returning();
      if (input.makeDefault) await tx.update(buyerProfiles).set({ defaultAddressId: row!.id, updatedAt: new Date() }).where(eq(buyerProfiles.userId, principal.userId));
      await this.audit.record(tx, meta, { action: 'address.added', entityType: 'address', entityId: row!.id });
    });
    return this.listAddresses(principal);
  }

  async setDefaultAddress(principal: Principal, addressId: string) {
    await this.ownAddress(principal, addressId);
    const updated = await this.db.update(buyerProfiles).set({ defaultAddressId: addressId, updatedAt: new Date() }).where(eq(buyerProfiles.userId, principal.userId)).returning();
    if (!updated.length) throw Errors.badRequest('NOT_A_BUYER', 'Only buyers have delivery addresses');
    return this.listAddresses(principal);
  }

  async deleteAddress(principal: Principal, addressId: string, meta: RequestMeta) {
    await this.ownAddress(principal, addressId);
    const [buyer] = await this.db.select().from(buyerProfiles).where(eq(buyerProfiles.userId, principal.userId));
    if (buyer?.defaultAddressId === addressId) throw Errors.conflict('DEFAULT_ADDRESS', 'Choose another default address before deleting this one');
    await this.db.transaction(async (tx) => {
      await tx.delete(addresses).where(eq(addresses.id, addressId));
      await this.audit.record(tx, meta, { action: 'address.deleted', entityType: 'address', entityId: addressId });
    });
    return this.listAddresses(principal);
  }

  private async ownAddress(principal: Principal, addressId: string) {
    const [row] = await this.db.select().from(addresses).where(and(eq(addresses.id, addressId), eq(addresses.userId, principal.userId)));
    const [seller] = await this.db.select({ addressId: sellerProfiles.addressId }).from(sellerProfiles).where(eq(sellerProfiles.userId, principal.userId));
    if (!row || row.id === seller?.addressId) throw Errors.notFound('Address');
    return row;
  }
}
