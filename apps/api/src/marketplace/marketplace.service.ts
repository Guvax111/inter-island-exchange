import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { ProductSearchInput } from '@iie/shared';
import { Database, DB } from '../db/db';
import { categories, countries, currencies, lanes, products, sellerProfiles, sellerStorefronts, users } from '../db/schema';
import { Errors } from '../common/errors';
import { toMoneyDto } from '../common/money';
import { CategoriesService } from '../catalog/categories.service';
import { ProductsService } from '../catalog/products.service';
import { PUBLIC_PRODUCT_JOINS, publicProductWhere, publicSellerWhere } from '../catalog/visibility';
import { PRODUCT_SEARCH, ProductSearchProvider } from './search.provider';
import { TariffsService } from '../tariffs/tariffs.service';
import { ReviewsService } from '../reviews/reviews.service';

@Injectable()
export class MarketplaceService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PRODUCT_SEARCH) private readonly searchProvider: ProductSearchProvider,
    private readonly categories: CategoriesService,
    private readonly products: ProductsService,
    private readonly tariffs: TariffsService,
    private readonly reviews: ReviewsService,
  ) {}

  async search(input: ProductSearchInput) {
    const categoryIds = input.category ? await this.categories.descendantIds(input.category) : undefined;
    const { hits, total } = await this.searchProvider.search({ ...input, categoryIds });
    const currencyRows = await this.db.select().from(currencies);
    const byCode = new Map(currencyRows.map((c) => [c.code, c]));
    return {
      items: hits.map((h) => ({
        id: h.id,
        title: h.title,
        shortDescription: h.shortDescription,
        priceFrom: toMoneyDto(h.minPriceMinor, byCode.get(h.currencyCode)!),
        inStock: h.available > 0,
        imageUrl: h.imageMediaId ? `/api/v1/media/${h.imageMediaId}` : null,
        seller: { slug: h.storeSlug, name: h.storeName, country: h.sellerCountry, countryName: h.sellerCountryName },
      })),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  /** Public product page. Hidden or unknown products are 404s. */
  async product(productId: string) {
    const [row] = await this.db
      .select({ product: products, storefront: sellerStorefronts, country: countries })
      .from(products)
      .innerJoin(sellerProfiles, PUBLIC_PRODUCT_JOINS.seller)
      .innerJoin(users, PUBLIC_PRODUCT_JOINS.user)
      .innerJoin(countries, PUBLIC_PRODUCT_JOINS.country)
      .leftJoin(sellerStorefronts, PUBLIC_PRODUCT_JOINS.storefront)
      .where(and(eq(products.id, productId), publicProductWhere()));
    if (!row) throw Errors.notFound('Product');
    const detail = await this.products.detail(row.product);
    const destinations = await this.destinationsFrom(row.country.id);
    return {
      id: detail.id,
      title: detail.title,
      shortDescription: detail.shortDescription,
      description: detail.description,
      brand: detail.brand,
      hsCode: detail.hsCode,
      categoryPath: detail.categoryPath,
      countryOfOrigin: detail.countryOfOrigin,
      weightGrams: detail.weightGrams,
      dimensionsMm: detail.lengthMm && detail.widthMm && detail.heightMm ? { length: detail.lengthMm, width: detail.widthMm, height: detail.heightMm } : null,
      attributes: detail.attributes,
      images: detail.images,
      inStock: detail.status === 'ACTIVE',
      variants: detail.variants
        .filter((v) => !v.archived)
        .map((v) => ({ id: v.id, sku: v.sku, name: v.name, price: v.price, available: Math.max(0, v.quantityOnHand - v.quantityReserved) })),
      seller: { ...this.sellerCard(row.storefront!, row.country), rating: await this.reviews.sellerRating(row.product.sellerProfileId) },
      // Published reviews of orders that included this product (IIE approves every review first).
      rating: await this.reviews.productRating(detail.id),
      reviews: await this.reviews.published({ productId: detail.id }, 10),
      shipsFrom: { code: row.country.isoAlpha2, name: row.country.name },
      shipsTo: destinations,
      // Import information for each country the product can be shipped to, from IIE's tariff schedules.
      importInfo: detail.hsCode
        ? await Promise.all(destinations.map(async (d) => ({ destination: d, tariff: await this.tariffs.lookup(d.code, detail.hsCode!, detail.countryOfOrigin?.code) })))
        : [],
    };
  }

  async storefront(slug: string) {
    const [row] = await this.db
      .select({ storefront: sellerStorefronts, country: countries, seller: sellerProfiles })
      .from(sellerStorefronts)
      .innerJoin(sellerProfiles, eq(sellerProfiles.id, sellerStorefronts.sellerProfileId))
      .innerJoin(users, eq(users.id, sellerProfiles.userId))
      .innerJoin(countries, eq(countries.id, sellerProfiles.countryId))
      .where(and(eq(sellerStorefronts.slug, slug), publicSellerWhere()));
    if (!row) throw Errors.notFound('Seller');
    const productCategories = await this.db
      .selectDistinct({ slug: categories.slug, name: categories.name })
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .where(and(eq(products.sellerProfileId, row.seller.id), sql`${products.status} in ('ACTIVE', 'OUT_OF_STOCK')`))
      .orderBy(asc(categories.name));
    return {
      ...this.sellerCard(row.storefront, row.country),
      description: row.storefront.description,
      shippingOrigin: row.storefront.shippingOrigin || row.country.name,
      returnPolicy: row.storefront.returnPolicy,
      storePolicies: row.storefront.storePolicies,
      categories: productCategories,
      memberSince: row.seller.payoutSetupConfirmedAt ?? row.seller.createdAt,
      // Published reviews only: IIE approves every review first.
      rating: await this.reviews.sellerRating(row.seller.id),
      reviews: await this.reviews.published({ sellerProfileId: row.seller.id }, 20),
      completedTransactions: await this.reviews.completedOrders(row.seller.id),
      shipsTo: await this.destinationsFrom(row.country.id),
    };
  }

  async sellers(countryCode?: string) {
    const rows = await this.db
      .select({ storefront: sellerStorefronts, country: countries })
      .from(sellerStorefronts)
      .innerJoin(sellerProfiles, eq(sellerProfiles.id, sellerStorefronts.sellerProfileId))
      .innerJoin(users, eq(users.id, sellerProfiles.userId))
      .innerJoin(countries, eq(countries.id, sellerProfiles.countryId))
      .where(and(publicSellerWhere(), countryCode ? eq(countries.isoAlpha2, countryCode) : undefined))
      .orderBy(asc(sellerStorefronts.displayName));
    return rows.map((r) => this.sellerCard(r.storefront, r.country));
  }

  private sellerCard(storefront: typeof sellerStorefronts.$inferSelect, country: typeof countries.$inferSelect) {
    return {
      slug: storefront.slug,
      name: storefront.displayName,
      logoUrl: storefront.logoMediaId ? `/api/v1/media/${storefront.logoMediaId}` : null,
      country: country.isoAlpha2,
      countryName: country.name,
      // Every public seller passed IIE review; the badge says exactly that.
      verified: true,
    };
  }

  private async destinationsFrom(originCountryId: string) {
    return this.db
      .select({ code: countries.isoAlpha2, name: countries.name })
      .from(lanes)
      .innerJoin(countries, eq(countries.id, lanes.destinationCountryId))
      .where(and(eq(lanes.originCountryId, originCountryId), eq(lanes.enabled, true), eq(countries.marketplaceEnabled, true)))
      .orderBy(asc(countries.name));
  }
}
