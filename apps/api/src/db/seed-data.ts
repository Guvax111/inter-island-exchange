/**
 * Reference data for a fresh environment. Countries are configuration, not code: after seeding,
 * administrators change them through the admin API. The seed never overwrites existing countries.
 */
export const SEED_CURRENCIES = [
  { code: 'XCD', name: 'East Caribbean Dollar', symbol: 'EC$', minorUnit: 2 },
  { code: 'USD', name: 'US Dollar', symbol: 'US$', minorUnit: 2 },
  { code: 'TTD', name: 'Trinidad and Tobago Dollar', symbol: 'TT$', minorUnit: 2 },
  { code: 'BBD', name: 'Barbados Dollar', symbol: 'Bds$', minorUnit: 2 },
  { code: 'JMD', name: 'Jamaican Dollar', symbol: 'J$', minorUnit: 2 },
  { code: 'GYD', name: 'Guyanese Dollar', symbol: 'G$', minorUnit: 2 },
];

/**
 * iieCode: SLU and SVG come from the IIE brief. Other countries default to their ISO alpha-3 code
 * until IIE chooses brand codes.
 */
export const SEED_COUNTRIES = [
  { isoAlpha2: 'LC', isoAlpha3: 'LCA', name: 'St. Lucia', iieCode: 'SLU', slug: 'stlucia', currencyCode: 'XCD', marketplaceEnabled: true },
  { isoAlpha2: 'VC', isoAlpha3: 'VCT', name: 'St. Vincent and the Grenadines', iieCode: 'SVG', slug: 'stvincent', currencyCode: 'XCD', marketplaceEnabled: true },
  { isoAlpha2: 'GD', isoAlpha3: 'GRD', name: 'Grenada', iieCode: 'GRD', slug: 'grenada', currencyCode: 'XCD', marketplaceEnabled: false },
  { isoAlpha2: 'BB', isoAlpha3: 'BRB', name: 'Barbados', iieCode: 'BRB', slug: 'barbados', currencyCode: 'BBD', marketplaceEnabled: false },
  { isoAlpha2: 'TT', isoAlpha3: 'TTO', name: 'Trinidad and Tobago', iieCode: 'TTO', slug: 'trinidad', currencyCode: 'TTD', marketplaceEnabled: false },
  { isoAlpha2: 'JM', isoAlpha3: 'JAM', name: 'Jamaica', iieCode: 'JAM', slug: 'jamaica', currencyCode: 'JMD', marketplaceEnabled: false },
  { isoAlpha2: 'GY', isoAlpha3: 'GUY', name: 'Guyana', iieCode: 'GUY', slug: 'guyana', currencyCode: 'GYD', marketplaceEnabled: false },
  { isoAlpha2: 'DM', isoAlpha3: 'DMA', name: 'Dominica', iieCode: 'DMA', slug: 'dominica', currencyCode: 'XCD', marketplaceEnabled: false },
  { isoAlpha2: 'AG', isoAlpha3: 'ATG', name: 'Antigua and Barbuda', iieCode: 'ATG', slug: 'antigua', currencyCode: 'XCD', marketplaceEnabled: false },
  { isoAlpha2: 'KN', isoAlpha3: 'KNA', name: 'St. Kitts and Nevis', iieCode: 'KNA', slug: 'stkitts', currencyCode: 'XCD', marketplaceEnabled: false },
];

/** Pilot lane: St. Lucia -> St. Vincent and the Grenadines. */
export const SEED_LANES = [{ origin: 'LC', destination: 'VC', enabled: true }];

/** Starter category tree. Administrators manage categories afterwards; the seed never renames or removes them. */
export const SEED_CATEGORIES: { slug: string; name: string; parent?: string; sortOrder: number }[] = [
  { slug: 'baby-and-child', name: 'Baby & Child', sortOrder: 10 },
  { slug: 'diapers-and-wipes', name: 'Diapers & Wipes', parent: 'baby-and-child', sortOrder: 10 },
  { slug: 'baby-food', name: 'Baby Food', parent: 'baby-and-child', sortOrder: 20 },
  { slug: 'baby-care', name: 'Baby Care', parent: 'baby-and-child', sortOrder: 30 },
  { slug: 'food-and-beverage', name: 'Food & Beverage', sortOrder: 20 },
  { slug: 'health-and-beauty', name: 'Health & Beauty', sortOrder: 30 },
  { slug: 'household', name: 'Household', sortOrder: 40 },
  { slug: 'clothing-and-accessories', name: 'Clothing & Accessories', sortOrder: 50 },
  { slug: 'arts-and-crafts', name: 'Arts & Crafts', sortOrder: 60 },
  { slug: 'electronics', name: 'Electronics', sortOrder: 70 },
  { slug: 'agriculture', name: 'Agriculture', sortOrder: 80 },
  { slug: 'other', name: 'Other', sortOrder: 1000 },
];

/**
 * A few HS reference entries (6-digit headings) relevant to the pilot. Informational only: products store
 * their own code, and the compliance engine (Phase 6) will use a complete, authoritative tariff dataset.
 */
export const SEED_HS_CODES = [
  { code: '961900', description: 'Sanitary towels and tampons, napkins (diapers) and napkin liners for babies, and similar articles, of any material' },
  { code: '190110', description: 'Food preparations for infant use, put up for retail sale' },
  { code: '340111', description: 'Soap and organic surface-active products in bars or cakes, for toilet use' },
];

/** IIE platform fee for the pilot: 5%, paid by the buyer unless the seller chooses to absorb it. */
export const SEED_FEE_RULE = { percentBps: 500, defaultPayer: 'BUYER' as const };

/**
 * PLACEHOLDER shipping rates for St. Lucia -> St. Vincent (XCD), until the logistics partner supplies real ones.
 * Flagged isPlaceholder so administrators can see which rates still need replacing.
 */
export const SEED_SHIPPING_RATES = [
  { origin: 'LC', destination: 'VC', serviceName: 'Standard regional freight', maxWeightGrams: 1_000, priceMinor: 2500n },
  { origin: 'LC', destination: 'VC', serviceName: 'Standard regional freight', maxWeightGrams: 2_000, priceMinor: 3500n },
  { origin: 'LC', destination: 'VC', serviceName: 'Standard regional freight', maxWeightGrams: 5_000, priceMinor: 5500n },
  { origin: 'LC', destination: 'VC', serviceName: 'Standard regional freight', maxWeightGrams: 10_000, priceMinor: 8500n },
  { origin: 'LC', destination: 'VC', serviceName: 'Standard regional freight', maxWeightGrams: 20_000, priceMinor: 14000n },
];

/**
 * St. Vincent and the Grenadines duty/tax ESTIMATE used for the pilot. Goods of CARICOM origin generally enter
 * duty-free under the CARICOM common market; VAT applies. Placeholder until confirmed with a customs broker.
 */
export const SEED_DUTY_ESTIMATES = [
  {
    destination: 'VC',
    hsPrefix: '',
    caricomOriginDutyBps: 0,
    otherOriginDutyBps: 2000,
    vatBps: 1600,
    notes: 'Pilot estimate: 0% duty on CARICOM-origin goods, 20% placeholder on other origins, 16% VAT on value plus shipping plus duty. Confirm with a customs broker.',
  },
];
