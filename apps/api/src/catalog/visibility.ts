import { and, eq, inArray, isNotNull, type SQL } from 'drizzle-orm';
import { PUBLIC_PRODUCT_STATUSES } from '@iie/shared';
import { countries, products, sellerProfiles, sellerStorefronts, users } from '../db/schema';

/**
 * The single definition of "shown on the public marketplace". Use with a query that joins
 * products -> seller_profiles -> users, seller_storefronts and the seller's country.
 *
 * A product is public only when it is approved (ACTIVE or OUT_OF_STOCK), its seller is ACTIVE with an ACTIVE
 * account and a storefront, and the seller's country marketplace is open.
 */
export function publicProductWhere(): SQL {
  return and(
    inArray(products.status, [...PUBLIC_PRODUCT_STATUSES]),
    eq(sellerProfiles.status, 'ACTIVE'),
    eq(users.status, 'ACTIVE'),
    eq(countries.marketplaceEnabled, true),
    isNotNull(sellerStorefronts.id),
  )!;
}

/** Same rule for a seller's storefront page. */
export function publicSellerWhere(): SQL {
  return and(eq(sellerProfiles.status, 'ACTIVE'), eq(users.status, 'ACTIVE'), eq(countries.marketplaceEnabled, true))!;
}

/** Joins needed by publicProductWhere(), starting from products. */
export const PUBLIC_PRODUCT_JOINS = {
  seller: eq(sellerProfiles.id, products.sellerProfileId),
  user: eq(users.id, sellerProfiles.userId),
  storefront: eq(sellerStorefronts.sellerProfileId, sellerProfiles.id),
  country: eq(countries.id, sellerProfiles.countryId),
};

export const isPublicStatus = (status: string) => (PUBLIC_PRODUCT_STATUSES as readonly string[]).includes(status);
