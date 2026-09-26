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
  // Currencies of the origin-only countries below (not used for pricing).
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', minorUnit: 2 },
  { code: 'GBP', name: 'Pound Sterling', symbol: '£', minorUnit: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', minorUnit: 2 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: 'CN¥', minorUnit: 2 },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', minorUnit: 2 },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', minorUnit: 2 },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$', minorUnit: 2 },
  { code: 'COP', name: 'Colombian Peso', symbol: 'COL$', minorUnit: 2 },
  { code: 'DOP', name: 'Dominican Peso', symbol: 'RD$', minorUnit: 2 },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', minorUnit: 0 },
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

/**
 * Countries outside CARICOM, recorded only as a product's country of origin: goods from them pay the general (CET)
 * duty rather than the CARICOM rate. They have no marketplace, lanes or sign-up; the public country list hides them.
 */
export const SEED_ORIGIN_COUNTRIES = [
  { isoAlpha2: 'US', isoAlpha3: 'USA', name: 'United States', currencyCode: 'USD' },
  { isoAlpha2: 'CA', isoAlpha3: 'CAN', name: 'Canada', currencyCode: 'CAD' },
  { isoAlpha2: 'GB', isoAlpha3: 'GBR', name: 'United Kingdom', currencyCode: 'GBP' },
  { isoAlpha2: 'CN', isoAlpha3: 'CHN', name: 'China', currencyCode: 'CNY' },
  { isoAlpha2: 'IN', isoAlpha3: 'IND', name: 'India', currencyCode: 'INR' },
  { isoAlpha2: 'BR', isoAlpha3: 'BRA', name: 'Brazil', currencyCode: 'BRL' },
  { isoAlpha2: 'MX', isoAlpha3: 'MEX', name: 'Mexico', currencyCode: 'MXN' },
  { isoAlpha2: 'CO', isoAlpha3: 'COL', name: 'Colombia', currencyCode: 'COP' },
  { isoAlpha2: 'DO', isoAlpha3: 'DOM', name: 'Dominican Republic', currencyCode: 'DOP' },
  { isoAlpha2: 'DE', isoAlpha3: 'DEU', name: 'Germany', currencyCode: 'EUR' },
  { isoAlpha2: 'FR', isoAlpha3: 'FRA', name: 'France', currencyCode: 'EUR' },
  { isoAlpha2: 'ES', isoAlpha3: 'ESP', name: 'Spain', currencyCode: 'EUR' },
  { isoAlpha2: 'IT', isoAlpha3: 'ITA', name: 'Italy', currencyCode: 'EUR' },
  { isoAlpha2: 'NL', isoAlpha3: 'NLD', name: 'Netherlands', currencyCode: 'EUR' },
  { isoAlpha2: 'JP', isoAlpha3: 'JPN', name: 'Japan', currencyCode: 'JPY' },
].map((c) => ({ ...c, iieCode: c.isoAlpha3, slug: `origin-${c.isoAlpha2.toLowerCase()}`, regionalBloc: 'EXTRA_REGIONAL', marketplaceEnabled: false }));

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

/**
 * Reference exchange rates: fixed central-bank pegs (1 USD = 2.70 XCD, ECCB; 1 USD = 2.00 BBD, Central Bank of
 * Barbados). Floating currencies (TTD, JMD, GYD) need a rate feed or administrator entries before they are used.
 */
export const SEED_EXCHANGE_RATES = [
  { baseCurrency: 'USD', quoteCurrency: 'XCD', rate: '2.70000000', source: 'ECCB_PEG' },
  { baseCurrency: 'XCD', quoteCurrency: 'USD', rate: '0.37037037', source: 'ECCB_PEG' },
  { baseCurrency: 'USD', quoteCurrency: 'BBD', rate: '2.00000000', source: 'CBB_PEG' },
  { baseCurrency: 'BBD', quoteCurrency: 'USD', rate: '0.50000000', source: 'CBB_PEG' },
];
