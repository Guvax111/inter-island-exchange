import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { MAX_CART_QUANTITY } from '@iie/shared';
import { Database, DB } from '../db/db';
import { cartItems, carts, countries, currencies, inventory, lanes, productImages, products, productVariants, sellerProfiles, sellerStorefronts, users } from '../db/schema';
import { AppError, Errors } from '../common/errors';
import { toMoneyDto } from '../common/money';
import { isPublicStatus } from '../catalog/visibility';
import type { Principal } from '../rbac/principal';

export type LineIssue = 'UNAVAILABLE' | 'NOT_SHIPPABLE_TO_YOU' | 'INSUFFICIENT_STOCK';

/**
 * The cart stores quantities only. Every read uses live prices and availability; checkout (Phase 3) freezes
 * prices into the order. Pilot rule: each seller is checked out separately.
 */
@Injectable()
export class CartService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async get(principal: Principal) {
    const cart = await this.cartFor(principal.userId);
    const rows = await this.lineQuery(principal, cart.id).where(eq(cartItems.cartId, cart.id)).orderBy(asc(cartItems.createdAt));

    const groups = new Map<string, { seller: { slug: string | null; name: string; country: string; countryName: string }; lines: ReturnType<CartService['toLine']>[]; subtotalMinor: bigint; currency: typeof currencies.$inferSelect }>();
    for (const row of rows) {
      const line = this.toLine(row);
      const key = row.sellerId;
      const group = groups.get(key) ?? {
        seller: { slug: row.storeSlug, name: row.storeName ?? row.sellerLegalName, country: row.sellerCountry, countryName: row.sellerCountryName },
        lines: [],
        subtotalMinor: 0n,
        currency: row.currency,
      };
      group.lines.push(line);
      if (!line.issues.length) group.subtotalMinor += row.priceMinor * BigInt(row.quantity);
      groups.set(key, group);
    }
    const sellerGroups = [...groups.values()].map((g) => ({
      seller: g.seller,
      lines: g.lines,
      subtotal: toMoneyDto(g.subtotalMinor, g.currency),
      readyForCheckout: g.lines.length > 0 && g.lines.every((l) => !l.issues.length),
    }));
    return {
      sellers: sellerGroups,
      itemCount: rows.reduce((n, r) => n + r.quantity, 0),
      notes: [
        'Shipping, duties and taxes, and IIE fees are calculated at checkout.',
        ...(sellerGroups.length > 1 ? ['Your cart has items from more than one seller. Each seller is checked out and shipped separately.'] : []),
      ],
    };
  }

  async add(principal: Principal, variantId: string, quantity: number) {
    const cart = await this.cartFor(principal.userId);
    await this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(cartItems).where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, variantId))).for('update');
      const total = (existing?.quantity ?? 0) + quantity;
      await this.assertPurchasable(principal, cart.id, variantId, total);
      if (existing) await tx.update(cartItems).set({ quantity: total, updatedAt: new Date() }).where(eq(cartItems.id, existing.id));
      else await tx.insert(cartItems).values({ cartId: cart.id, variantId, quantity });
      await tx.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
    });
    return this.get(principal);
  }

  async setQuantity(principal: Principal, variantId: string, quantity: number) {
    const cart = await this.cartFor(principal.userId);
    const [line] = await this.db.select().from(cartItems).where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, variantId)));
    if (!line) throw Errors.notFound('Cart item');
    // Lowering a quantity is always allowed; raising it must fit the stock.
    if (quantity > line.quantity) await this.assertPurchasable(principal, cart.id, variantId, quantity);
    await this.db.update(cartItems).set({ quantity, updatedAt: new Date() }).where(eq(cartItems.id, line.id));
    return this.get(principal);
  }

  async remove(principal: Principal, variantId: string) {
    const cart = await this.cartFor(principal.userId);
    const removed = await this.db.delete(cartItems).where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, variantId))).returning();
    if (!removed.length) throw Errors.notFound('Cart item');
    return this.get(principal);
  }

  async clear(principal: Principal) {
    const cart = await this.cartFor(principal.userId);
    await this.db.delete(cartItems).where(eq(cartItems.cartId, cart.id));
    return this.get(principal);
  }

  // ------------------------------------------------------------------ helpers

  private async assertPurchasable(principal: Principal, cartId: string, variantId: string, quantity: number) {
    if (quantity > MAX_CART_QUANTITY) throw Errors.badRequest('QUANTITY_TOO_HIGH', `You can add up to ${MAX_CART_QUANTITY} of an item`);
    const [row] = await this.lineQuery(principal, cartId).where(eq(productVariants.id, variantId));
    if (!row) throw Errors.notFound('Product');
    const line = this.toLine({ ...row, quantity });
    if (row.sellerUserId === principal.userId) throw Errors.badRequest('OWN_PRODUCT', 'You cannot buy your own products');
    if (line.issues.includes('UNAVAILABLE')) throw Errors.notFound('Product');
    if (line.issues.includes('NOT_SHIPPABLE_TO_YOU')) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'NOT_SHIPPABLE_TO_YOU', `This seller does not ship to your country yet`);
    }
    if (line.issues.includes('INSUFFICIENT_STOCK')) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'INSUFFICIENT_STOCK', line.available ? `Only ${line.available} available` : 'This item is out of stock');
    }
  }

  /** Variant, product, seller and availability details, with this cart's quantity for the variant (0 if absent). */
  private lineQuery(principal: Principal, cartId: string) {
    return this.db
      .select({
        variantId: productVariants.id,
        variantName: productVariants.name,
        sku: productVariants.sku,
        archived: productVariants.archived,
        priceMinor: productVariants.priceMinor,
        currency: currencies,
        productId: products.id,
        productTitle: products.title,
        productStatus: products.status,
        sellerId: sellerProfiles.id,
        sellerStatus: sellerProfiles.status,
        sellerLegalName: sellerProfiles.legalName,
        sellerUserId: sellerProfiles.userId,
        sellerUserStatus: users.status,
        sellerCountry: countries.isoAlpha2,
        sellerCountryName: countries.name,
        sellerCountryOpen: countries.marketplaceEnabled,
        storeSlug: sellerStorefronts.slug,
        storeName: sellerStorefronts.displayName,
        available: sql<number>`coalesce(${inventory.quantityOnHand} - ${inventory.quantityReserved}, 0)::int`,
        shipsToBuyer: sql<boolean>`exists (
          select 1 from ${lanes} l join ${countries} d on d.id = l.destination_country_id
          where l.origin_country_id = ${countries.id} and l.enabled and d.marketplace_enabled and d.id = ${principal.countryId})`,
        imageMediaId: sql<string | null>`(select pi.media_id from ${productImages} pi where pi.product_id = ${products.id} order by pi.sort_order limit 1)`,
        quantity: sql<number>`coalesce(${cartItems.quantity}, 0)::int`,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .innerJoin(currencies, eq(currencies.code, productVariants.currencyCode))
      .innerJoin(sellerProfiles, eq(sellerProfiles.id, products.sellerProfileId))
      .innerJoin(users, eq(users.id, sellerProfiles.userId))
      .innerJoin(countries, eq(countries.id, sellerProfiles.countryId))
      .leftJoin(sellerStorefronts, eq(sellerStorefronts.sellerProfileId, sellerProfiles.id))
      .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
      .leftJoin(cartItems, and(eq(cartItems.variantId, productVariants.id), eq(cartItems.cartId, cartId)))
      .$dynamic();
  }

  private toLine(row: Awaited<ReturnType<CartService['lineQuery']>>[number]) {
    const issues: LineIssue[] = [];
    const visible =
      isPublicStatus(row.productStatus) && !row.archived && row.sellerStatus === 'ACTIVE' && row.sellerUserStatus === 'ACTIVE' && row.sellerCountryOpen && !!row.storeSlug;
    if (!visible) issues.push('UNAVAILABLE');
    else if (!row.shipsToBuyer) issues.push('NOT_SHIPPABLE_TO_YOU');
    else if (row.quantity > row.available) issues.push('INSUFFICIENT_STOCK');
    return {
      variantId: row.variantId,
      productId: row.productId,
      title: row.productTitle,
      variantName: row.variantName,
      sku: row.sku,
      quantity: row.quantity,
      available: Math.max(0, row.available),
      unitPrice: toMoneyDto(row.priceMinor, row.currency),
      lineTotal: toMoneyDto(row.priceMinor * BigInt(row.quantity), row.currency),
      imageUrl: row.imageMediaId ? `/api/v1/media/${row.imageMediaId}` : null,
      issues,
    };
  }

  private async cartFor(userId: string) {
    const [cart] = await this.db.insert(carts).values({ userId }).onConflictDoUpdate({ target: carts.userId, set: { userId } }).returning();
    return cart!;
  }
}
