import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  parseDecimalToMinor,
  PRODUCT_CONTENT_FIELDS,
  type inventoryAdjustSchema,
  type ProductCreateInput,
  type ProductUpdateInput,
  type ReviewDecision,
  type VariantInput,
  type variantUpdateSchema,
} from '@iie/shared';
import { Database, DB, Tx } from '../db/db';
import {
  countries,
  currencies,
  inventory,
  inventoryMovements,
  productImages,
  products,
  productVariants,
  sellerProfiles,
  users,
} from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { EVENTS } from '../email/notification.dispatcher';
import { AppError, Errors } from '../common/errors';
import { toMoneyDto } from '../common/money';
import type { RequestMeta } from '../common/request';
import type { Principal } from '../rbac/principal';
import { MediaService } from '../media/media.service';
import { CategoriesService } from './categories.service';

type ProductRow = typeof products.$inferSelect;
type SellerRow = typeof sellerProfiles.$inferSelect;

/** Sellers may build products once approved; products reach the marketplace only when the seller is ACTIVE. */
const SELLER_CAN_EDIT = ['APPROVED', 'ACTIVE'];
const MAX_IMAGES = 8;
const LIVE = ['ACTIVE', 'OUT_OF_STOCK'];

@Injectable()
export class ProductsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly media: MediaService,
    private readonly categories: CategoriesService,
  ) {}

  // ------------------------------------------------------------------ seller side

  async listMine(principal: Principal) {
    const seller = await this.requireSeller(principal, false);
    const rows = await this.db.select().from(products).where(eq(products.sellerProfileId, seller.id)).orderBy(desc(products.updatedAt));
    return Promise.all(rows.map((p) => this.detail(p)));
  }

  async getMine(principal: Principal, productId: string) {
    const { product } = await this.loadOwn(principal, productId, false);
    return this.detail(product);
  }

  async create(principal: Principal, input: ProductCreateInput, meta: RequestMeta) {
    const seller = await this.requireSeller(principal, true);
    const currency = await this.sellerCurrency(seller);
    const category = await this.requireCategory(input.categorySlug);
    const origin = await this.requireCountry(input.countryOfOrigin);

    const id = await this.db.transaction(async (tx) => {
      const { variants, categorySlug: _c, countryOfOrigin: _o, ...fields } = input;
      const [product] = await tx
        .insert(products)
        .values({ ...fields, brand: fields.brand ?? null, hsCode: fields.hsCode ?? null, sellerProfileId: seller.id, categoryId: category.id, countryOfOriginId: origin.id })
        .returning();
      for (const [i, v] of variants.entries()) await this.insertVariant(tx, product!, seller, currency, v, i, principal.userId);
      await this.audit.record(tx, meta, { action: 'product.created', entityType: 'product', entityId: product!.id, after: { title: product!.title, variants: variants.length } });
      return product!.id;
    });
    return this.getMine(principal, id);
  }

  /**
   * Edits to a live product's content (title, descriptions, category, brand, HS code, origin, attributes)
   * send it back to review; dimensions, weight, prices and stock change immediately.
   */
  async update(principal: Principal, productId: string, patch: ProductUpdateInput, meta: RequestMeta) {
    const { product } = await this.loadOwn(principal, productId, true);
    this.assertEditable(product);
    const { categorySlug, countryOfOrigin, ...fields } = patch;
    const set: Partial<typeof products.$inferInsert> = { ...fields, updatedAt: new Date() };
    if (categorySlug) set.categoryId = (await this.requireCategory(categorySlug)).id;
    if (countryOfOrigin) set.countryOfOriginId = (await this.requireCountry(countryOfOrigin)).id;
    const contentChanged = PRODUCT_CONTENT_FIELDS.some((f) => patch[f] !== undefined);
    if (product.status === 'REJECTED') set.status = 'DRAFT';
    else if (LIVE.includes(product.status) && contentChanged) set.status = 'PENDING_REVIEW';
    if (set.status === 'PENDING_REVIEW') set.submittedAt = new Date();

    await this.db.transaction(async (tx) => {
      await tx.update(products).set(set).where(eq(products.id, product.id));
      await this.audit.record(tx, meta, {
        action: 'product.updated',
        entityType: 'product',
        entityId: product.id,
        before: { status: product.status, ...Object.fromEntries(Object.keys(fields).map((k) => [k, product[k as keyof ProductRow]])) },
        after: { status: set.status ?? product.status, ...patch },
      });
    });
    return this.getMine(principal, productId);
  }

  async addVariant(principal: Principal, productId: string, input: VariantInput, meta: RequestMeta) {
    const { product, seller } = await this.loadOwn(principal, productId, true);
    this.assertEditable(product);
    const currency = await this.sellerCurrency(seller);
    await this.db.transaction(async (tx) => {
      const [{ count }] = (await tx.select({ count: sql<number>`count(*)::int` }).from(productVariants).where(eq(productVariants.productId, product.id))) as [{ count: number }];
      const variant = await this.insertVariant(tx, product, seller, currency, input, count, principal.userId);
      await this.syncStockStatus(tx, product.id);
      await this.audit.record(tx, meta, { action: 'product.variant_added', entityType: 'product', entityId: product.id, after: { variantId: variant.id, sku: input.sku } });
    });
    return this.getMine(principal, productId);
  }

  async updateVariant(principal: Principal, productId: string, variantId: string, patch: z.infer<typeof variantUpdateSchema>, meta: RequestMeta) {
    const { product, seller } = await this.loadOwn(principal, productId, true);
    this.assertEditable(product);
    const variant = await this.loadVariant(product.id, variantId);
    const currency = await this.sellerCurrency(seller);
    const set: Partial<typeof productVariants.$inferInsert> = { updatedAt: new Date() };
    if (patch.name) set.name = patch.name;
    if (patch.price) set.priceMinor = this.parsePrice(patch.price, currency.minorUnit);
    await this.db.transaction(async (tx) => {
      await tx.update(productVariants).set(set).where(eq(productVariants.id, variant.id));
      await this.audit.record(tx, meta, {
        action: 'product.variant_updated',
        entityType: 'product_variant',
        entityId: variant.id,
        before: { name: variant.name, priceMinor: variant.priceMinor.toString() },
        after: { name: set.name ?? variant.name, priceMinor: (set.priceMinor ?? variant.priceMinor).toString() },
      });
    });
    return this.getMine(principal, productId);
  }

  /** A stock count: sets on-hand quantity and records the difference in the stock ledger. */
  async setStock(principal: Principal, productId: string, variantId: string, input: z.infer<typeof inventoryAdjustSchema>, meta: RequestMeta) {
    const { product } = await this.loadOwn(principal, productId, true);
    if (product.status === 'ARCHIVED') throw Errors.conflict('PRODUCT_ARCHIVED', 'Restore the product before changing stock');
    await this.loadVariant(product.id, variantId);
    await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(inventory).where(eq(inventory.variantId, variantId)).for('update');
      const before = current?.quantityOnHand ?? 0;
      if (input.quantity < (current?.quantityReserved ?? 0)) {
        throw Errors.badRequest('BELOW_RESERVED', `${current!.quantityReserved} units are reserved for pending orders`);
      }
      if (input.quantity === before) return;
      await tx.update(inventory).set({ quantityOnHand: input.quantity, updatedAt: new Date() }).where(eq(inventory.variantId, variantId));
      await tx.insert(inventoryMovements).values({
        variantId,
        delta: input.quantity - before,
        quantityAfter: input.quantity,
        reason: 'STOCK_COUNT',
        note: input.note ?? null,
        actorUserId: principal.userId,
      });
      await this.syncStockStatus(tx, product.id);
      await this.audit.record(tx, meta, { action: 'inventory.stock_count', entityType: 'product_variant', entityId: variantId, before: { quantityOnHand: before }, after: { quantityOnHand: input.quantity } });
    });
    return this.getMine(principal, productId);
  }

  async addImage(principal: Principal, productId: string, file: Express.Multer.File | undefined, altText: string | undefined, meta: RequestMeta) {
    const { product } = await this.loadOwn(principal, productId, true);
    this.assertEditable(product);
    await this.db.transaction(async (tx) => {
      const existing = await tx.select().from(productImages).where(eq(productImages.productId, product.id));
      if (existing.length >= MAX_IMAGES) throw Errors.badRequest('TOO_MANY_IMAGES', `A product can have up to ${MAX_IMAGES} images`);
      const asset = await this.media.storeImage(tx, principal.userId, 'PRODUCT_IMAGE', file);
      await tx.insert(productImages).values({ productId: product.id, mediaId: asset.id, altText: (altText ?? product.title).slice(0, 200), sortOrder: existing.length });
      // New pictures on a live product are content: they need review before customers see them.
      if (LIVE.includes(product.status)) {
        await tx.update(products).set({ status: 'PENDING_REVIEW', submittedAt: new Date(), updatedAt: new Date() }).where(eq(products.id, product.id));
      }
      await this.audit.record(tx, meta, { action: 'product.image_added', entityType: 'product', entityId: product.id, after: { mediaId: asset.id } });
    });
    return this.getMine(principal, productId);
  }

  async removeImage(principal: Principal, productId: string, imageId: string, meta: RequestMeta) {
    const { product } = await this.loadOwn(principal, productId, true);
    this.assertEditable(product);
    const file = await this.db.transaction(async (tx) => {
      const [image] = await tx.delete(productImages).where(and(eq(productImages.id, imageId), eq(productImages.productId, product.id))).returning();
      if (!image) throw Errors.notFound('Image');
      await this.audit.record(tx, meta, { action: 'product.image_removed', entityType: 'product', entityId: product.id, before: { mediaId: image.mediaId } });
      return this.media.detach(tx, image.mediaId);
    });
    await this.media.deleteFile(file);
    return this.getMine(principal, productId);
  }

  async submit(principal: Principal, productId: string, meta: RequestMeta) {
    const { product } = await this.loadOwn(principal, productId, true);
    if (!['DRAFT', 'REJECTED'].includes(product.status)) throw Errors.conflict('NOT_SUBMITTABLE', 'Only draft products can be submitted for review');
    const missing = await this.missingForSubmission(product);
    if (missing.length) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'PRODUCT_INCOMPLETE', 'Add the missing details before submitting', missing.map((path) => ({ path, message: 'Required for review' })));
    }
    await this.db.transaction(async (tx) => {
      await tx.update(products).set({ status: 'PENDING_REVIEW', submittedAt: new Date(), updatedAt: new Date() }).where(eq(products.id, product.id));
      await this.audit.record(tx, meta, { action: 'product.submitted', entityType: 'product', entityId: product.id, before: { status: product.status }, after: { status: 'PENDING_REVIEW' } });
    });
    return this.getMine(principal, productId);
  }

  async archive(principal: Principal, productId: string, archived: boolean, meta: RequestMeta) {
    const { product } = await this.loadOwn(principal, productId, false);
    if (archived && product.status === 'SUSPENDED') throw Errors.conflict('PRODUCT_SUSPENDED', 'Suspended products cannot be archived');
    if (!archived && product.status !== 'ARCHIVED') throw Errors.conflict('NOT_ARCHIVED', 'This product is not archived');
    const next = archived ? 'ARCHIVED' : 'DRAFT';
    await this.db.transaction(async (tx) => {
      await tx.update(products).set({ status: next, updatedAt: new Date() }).where(eq(products.id, product.id));
      await this.audit.record(tx, meta, { action: archived ? 'product.archived' : 'product.restored', entityType: 'product', entityId: product.id, before: { status: product.status }, after: { status: next } });
    });
    return this.getMine(principal, productId);
  }

  // ------------------------------------------------------------------ administration

  async listForReview(principal: Principal, status: string | undefined, page: number, pageSize: number) {
    const scope = principal.scopeOf('product.review');
    if (!scope) throw Errors.forbidden();
    const where = and(scope === 'ALL' ? undefined : inArray(sellerProfiles.countryId, [...scope]), status ? eq(products.status, status) : undefined);
    const rows = await this.db
      .select({ product: products, sellerName: sellerProfiles.legalName, country: countries.isoAlpha2 })
      .from(products)
      .innerJoin(sellerProfiles, eq(sellerProfiles.id, products.sellerProfileId))
      .innerJoin(countries, eq(countries.id, sellerProfiles.countryId))
      .where(where)
      .orderBy(asc(products.submittedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [total] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(products)
      .innerJoin(sellerProfiles, eq(sellerProfiles.id, products.sellerProfileId))
      .where(where);
    return {
      items: rows.map((r) => ({ id: r.product.id, title: r.product.title, status: r.product.status, submittedAt: r.product.submittedAt, hsCode: r.product.hsCode, seller: r.sellerName, country: r.country })),
      total: total?.count ?? 0,
      page,
      pageSize,
    };
  }

  async getForReview(principal: Principal, productId: string) {
    const { product, seller } = await this.loadInReviewScope(principal, productId);
    return { ...(await this.detail(product)), seller: { id: seller.id, legalName: seller.legalName, status: seller.status } };
  }

  async review(principal: Principal, productId: string, decision: ReviewDecision, meta: RequestMeta) {
    const { product, seller } = await this.loadInReviewScope(principal, productId);
    if (seller.userId === principal.userId) throw Errors.forbidden('You cannot review your own products');
    if (product.status !== 'PENDING_REVIEW') throw Errors.conflict('NOT_PENDING_REVIEW', 'This product is not waiting for review');
    await this.db.transaction(async (tx) => {
      let next = { APPROVE: 'ACTIVE', REJECT: 'REJECTED', REQUEST_CHANGES: 'DRAFT' }[decision.decision];
      await tx
        .update(products)
        .set({
          status: next,
          reviewedAt: new Date(),
          reviewedBy: principal.userId,
          reviewNotes: decision.notes ?? null,
          ...(decision.decision === 'APPROVE' && !product.publishedAt ? { publishedAt: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(products.id, product.id));
      if (decision.decision === 'APPROVE') next = await this.syncStockStatus(tx, product.id);
      const event = { APPROVE: EVENTS.productApproved, REJECT: EVENTS.productRejected, REQUEST_CHANGES: EVENTS.productChangesRequested }[decision.decision];
      const [owner] = await tx.select({ email: users.email, firstName: users.firstName }).from(users).where(eq(users.id, seller.userId));
      await this.outbox.enqueue(tx, event, { email: owner!.email, firstName: owner!.firstName, productId: product.id, productTitle: product.title, notes: decision.notes });
      await this.audit.record(tx, meta, {
        action: `product.review.${decision.decision.toLowerCase()}`,
        entityType: 'product',
        entityId: product.id,
        before: { status: product.status },
        after: { status: next, notes: decision.notes ?? null },
      });
    });
  }

  async setSuspended(principal: Principal, productId: string, suspended: boolean, reason: string, meta: RequestMeta) {
    const { product } = await this.loadInReviewScope(principal, productId);
    if (suspended && product.status === 'SUSPENDED') return;
    if (!suspended && product.status !== 'SUSPENDED') throw Errors.conflict('NOT_SUSPENDED', 'This product is not suspended');
    await this.db.transaction(async (tx) => {
      let next = suspended ? 'SUSPENDED' : 'ACTIVE';
      await tx.update(products).set({ status: next, updatedAt: new Date() }).where(eq(products.id, product.id));
      if (!suspended) next = await this.syncStockStatus(tx, product.id);
      await this.audit.record(tx, meta, { action: suspended ? 'product.suspended' : 'product.reinstated', entityType: 'product', entityId: product.id, before: { status: product.status }, after: { status: next, reason } });
    });
  }

  // ------------------------------------------------------------------ shared helpers

  /** ACTIVE <-> OUT_OF_STOCK from available stock across non-archived variants. Returns the resulting status. */
  async syncStockStatus(tx: Tx, productId: string): Promise<string> {
    const [row] = await tx
      .select({
        status: products.status,
        available: sql<number>`coalesce(sum(${inventory.quantityOnHand} - ${inventory.quantityReserved}) filter (where not ${productVariants.archived}), 0)::int`,
      })
      .from(products)
      .leftJoin(productVariants, eq(productVariants.productId, products.id))
      .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
      .where(eq(products.id, productId))
      .groupBy(products.status);
    if (!row || !LIVE.includes(row.status)) return row?.status ?? 'DRAFT';
    const next = row.available > 0 ? 'ACTIVE' : 'OUT_OF_STOCK';
    if (next !== row.status) await tx.update(products).set({ status: next, updatedAt: new Date() }).where(eq(products.id, productId));
    return next;
  }

  async detail(product: ProductRow) {
    const [variants, images, category, origin] = await Promise.all([
      this.db
        .select({ variant: productVariants, inv: inventory, currency: currencies })
        .from(productVariants)
        .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
        .innerJoin(currencies, eq(currencies.code, productVariants.currencyCode))
        .where(eq(productVariants.productId, product.id))
        .orderBy(asc(productVariants.sortOrder)),
      this.db.select().from(productImages).where(eq(productImages.productId, product.id)).orderBy(asc(productImages.sortOrder)),
      this.categories.path(product.categoryId),
      this.db.select({ code: countries.isoAlpha2, name: countries.name }).from(countries).where(eq(countries.id, product.countryOfOriginId)),
    ]);
    return {
      id: product.id,
      title: product.title,
      shortDescription: product.shortDescription,
      description: product.description,
      brand: product.brand,
      hsCode: product.hsCode,
      category: category.at(-1) ?? null,
      categoryPath: category,
      countryOfOrigin: origin[0] ?? null,
      weightGrams: product.weightGrams,
      lengthMm: product.lengthMm,
      widthMm: product.widthMm,
      heightMm: product.heightMm,
      attributes: product.attributes,
      status: product.status,
      reviewNotes: product.reviewNotes,
      submittedAt: product.submittedAt,
      updatedAt: product.updatedAt,
      variants: variants.map(({ variant, inv, currency }) => ({
        id: variant.id,
        sku: variant.sku,
        name: variant.name,
        price: toMoneyDto(variant.priceMinor, currency),
        quantityOnHand: inv?.quantityOnHand ?? 0,
        quantityReserved: inv?.quantityReserved ?? 0,
        archived: variant.archived,
      })),
      images: images.map((i) => ({ id: i.id, url: `/api/v1/media/${i.mediaId}`, altText: i.altText })),
    };
  }

  private async missingForSubmission(product: ProductRow): Promise<string[]> {
    const missing: string[] = [];
    if (!product.hsCode) missing.push('hsCode');
    if (!product.weightGrams) missing.push('weightGrams');
    if (!product.lengthMm || !product.widthMm || !product.heightMm) missing.push('dimensions');
    if (!product.description.trim()) missing.push('description');
    const [images] = await this.db.select({ count: sql<number>`count(*)::int` }).from(productImages).where(eq(productImages.productId, product.id));
    if (!images?.count) missing.push('images');
    return missing;
  }

  private assertEditable(product: ProductRow) {
    if (product.status === 'ARCHIVED') throw Errors.conflict('PRODUCT_ARCHIVED', 'Restore the product before editing it');
    if (product.status === 'SUSPENDED') throw Errors.conflict('PRODUCT_SUSPENDED', 'This product is suspended by IIE; contact support');
  }

  private async insertVariant(tx: Tx, product: ProductRow, seller: SellerRow, currency: { code: string; minorUnit: number }, v: VariantInput, sortOrder: number, actorUserId: string) {
    const [variant] = await tx
      .insert(productVariants)
      .values({ productId: product.id, sellerProfileId: seller.id, sku: v.sku, name: v.name, priceMinor: this.parsePrice(v.price, currency.minorUnit), currencyCode: currency.code, sortOrder })
      .onConflictDoNothing()
      .returning();
    if (!variant) throw Errors.conflict('SKU_TAKEN', `You already use SKU ${v.sku} on another product`);
    await tx.insert(inventory).values({ variantId: variant.id, quantityOnHand: v.quantity });
    if (v.quantity > 0) {
      await tx.insert(inventoryMovements).values({ variantId: variant.id, delta: v.quantity, quantityAfter: v.quantity, reason: 'INITIAL', actorUserId });
    }
    return variant;
  }

  private parsePrice(price: string, minorUnit: number): bigint {
    const minor = parseDecimalToMinor(price, minorUnit);
    if (minor <= 0n) throw Errors.badRequest('INVALID_PRICE', 'Price must be more than zero');
    return minor;
  }

  /** Pilot rule: sellers price in their own country's currency. Multi-currency pricing arrives with FX (Phase 4). */
  private async sellerCurrency(seller: SellerRow) {
    const [row] = await this.db
      .select({ code: currencies.code, minorUnit: currencies.minorUnit })
      .from(countries)
      .innerJoin(currencies, eq(currencies.code, countries.currencyCode))
      .where(eq(countries.id, seller.countryId));
    return row!;
  }

  private async requireSeller(principal: Principal, mustBeEditable: boolean): Promise<SellerRow> {
    const [seller] = await this.db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, principal.userId));
    if (!seller) throw Errors.notFound('Seller profile');
    if (mustBeEditable && !SELLER_CAN_EDIT.includes(seller.status)) {
      throw Errors.conflict('SELLER_NOT_APPROVED', 'You can list products once your seller application is approved');
    }
    return seller;
  }

  private async loadOwn(principal: Principal, productId: string, mustBeEditable: boolean) {
    const seller = await this.requireSeller(principal, mustBeEditable);
    const [product] = await this.db.select().from(products).where(and(eq(products.id, productId), eq(products.sellerProfileId, seller.id)));
    if (!product) throw Errors.notFound('Product');
    return { product, seller };
  }

  private async loadInReviewScope(principal: Principal, productId: string) {
    const [row] = await this.db
      .select({ product: products, seller: sellerProfiles })
      .from(products)
      .innerJoin(sellerProfiles, eq(sellerProfiles.id, products.sellerProfileId))
      .where(eq(products.id, productId));
    if (!row || !principal.canInCountry('product.review', row.seller.countryId)) throw Errors.notFound('Product');
    return row;
  }

  private async loadVariant(productId: string, variantId: string) {
    const [variant] = await this.db.select().from(productVariants).where(and(eq(productVariants.id, variantId), eq(productVariants.productId, productId)));
    if (!variant) throw Errors.notFound('Variant');
    return variant;
  }

  private async requireCategory(slug: string) {
    const category = await this.categories.bySlug(slug);
    if (!category || !category.active) throw Errors.badRequest('UNKNOWN_CATEGORY', 'Choose a category from the list');
    return category;
  }

  private async requireCountry(isoAlpha2: string) {
    const [country] = await this.db.select().from(countries).where(eq(countries.isoAlpha2, isoAlpha2));
    if (!country) throw Errors.badRequest('UNKNOWN_COUNTRY', 'Choose a country of origin from the list');
    return country;
  }
}
