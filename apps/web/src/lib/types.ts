/** Response shapes of the IIE API used by the web app. */
export interface Money {
  amountMinor: string;
  currency: string;
  formatted: string;
}

export interface SellerCard {
  slug: string;
  name: string;
  logoUrl?: string | null;
  country: string;
  countryName: string;
  verified?: boolean;
}

export interface ProductCard {
  id: string;
  title: string;
  shortDescription: string;
  priceFrom: Money;
  inStock: boolean;
  imageUrl: string | null;
  seller: SellerCard;
}

export interface SearchResult {
  items: ProductCard[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  children: CategoryNode[];
}

export interface PublicProduct {
  id: string;
  title: string;
  shortDescription: string;
  description: string;
  brand: string | null;
  hsCode: string | null;
  categoryPath: { slug: string; name: string }[];
  countryOfOrigin: { code: string; name: string } | null;
  weightGrams: number | null;
  dimensionsMm: { length: number; width: number; height: number } | null;
  attributes: Record<string, string>;
  images: { id: string; url: string; altText: string }[];
  inStock: boolean;
  variants: { id: string; sku: string; name: string; price: Money; available: number }[];
  seller: SellerCard;
  shipsFrom: { code: string; name: string };
  shipsTo: { code: string; name: string }[];
}

export interface Storefront extends SellerCard {
  description: string;
  shippingOrigin: string;
  returnPolicy: string;
  storePolicies: string;
  categories: { slug: string; name: string }[];
  memberSince: string;
  rating: number | null;
  completedTransactions: number | null;
  shipsTo: { code: string; name: string }[];
}

export interface SellerProduct {
  id: string;
  title: string;
  shortDescription: string;
  description: string;
  brand: string | null;
  hsCode: string | null;
  category: { slug: string; name: string } | null;
  categoryPath: { slug: string; name: string }[];
  countryOfOrigin: { code: string; name: string } | null;
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  status: string;
  reviewNotes: string | null;
  updatedAt: string;
  variants: { id: string; sku: string; name: string; price: Money; quantityOnHand: number; quantityReserved: number; archived: boolean }[];
  images: { id: string; url: string; altText: string }[];
}

export type LineIssue = 'UNAVAILABLE' | 'NOT_SHIPPABLE_TO_YOU' | 'INSUFFICIENT_STOCK';

export interface Cart {
  sellers: {
    seller: { slug: string | null; name: string; country: string; countryName: string };
    lines: {
      variantId: string;
      productId: string;
      title: string;
      variantName: string;
      sku: string;
      quantity: number;
      available: number;
      unitPrice: Money;
      lineTotal: Money;
      imageUrl: string | null;
      issues: LineIssue[];
    }[];
    subtotal: Money;
    readyForCheckout: boolean;
  }[];
  itemCount: number;
  notes: string[];
}

export function flattenCategories(nodes: CategoryNode[], depth = 0): { slug: string; label: string }[] {
  return nodes.flatMap((n) => [{ slug: n.slug, label: `${'— '.repeat(depth)}${n.name}` }, ...flattenCategories(n.children, depth + 1)]);
}
