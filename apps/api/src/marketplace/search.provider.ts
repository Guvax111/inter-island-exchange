import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { parseDecimalToMinor, type ProductSearchInput } from '@iie/shared';
import { Database, DB } from '../db/db';

export interface SearchHit {
  id: string;
  title: string;
  shortDescription: string;
  minPriceMinor: bigint;
  currencyCode: string;
  available: number;
  imageMediaId: string | null;
  storeSlug: string;
  storeName: string;
  sellerCountry: string;
  sellerCountryName: string;
}

/** Search abstraction: the Postgres implementation can be replaced by a dedicated search engine later. */
export interface ProductSearchProvider {
  search(input: ProductSearchInput & { categoryIds?: string[] }): Promise<{ hits: SearchHit[]; total: number }>;
}

export const PRODUCT_SEARCH = Symbol('PRODUCT_SEARCH');

/**
 * Turns free text into a prefix tsquery with AND semantics: "zeph diapers" -> "zeph:* & diapers:*".
 * Only letters and digits survive, so user input can never inject tsquery syntax. Postgres still stems each
 * word ("diapers" matches "diaper").
 */
export function toPrefixQuery(text: string): string | null {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) ?? [];
  return words.length ? words.map((w) => `${w}:*`).join(' & ') : null;
}

/**
 * Postgres full-text search: stemmed prefix matching on every word, ranked by weight (title > brand/summary >
 * description) plus trigram similarity to the title. Visibility rules match catalog/visibility.ts: approved product, active seller and account,
 * storefront present, seller's country open.
 */
@Injectable()
export class PostgresProductSearch implements ProductSearchProvider {
  constructor(@Inject(DB) private readonly db: Database) {}

  async search(input: ProductSearchInput & { categoryIds?: string[] }) {
    const where: SQL[] = [
      sql`p.status in ('ACTIVE', 'OUT_OF_STOCK')`,
      sql`sp.status = 'ACTIVE'`,
      sql`u.status = 'ACTIVE'`,
      sql`c.marketplace_enabled`,
    ];
    const q = input.q?.trim();
    const tsq = q ? toPrefixQuery(q) : null;
    if (q) where.push(tsq ? sql`p.search_vector @@ to_tsquery('english', ${tsq})` : sql`false`);
    if (input.categoryIds) where.push(input.categoryIds.length ? sql`p.category_id in ${input.categoryIds}` : sql`false`);
    if (input.seller) where.push(sql`sf.slug = ${input.seller}`);
    if (input.sellerCountry) where.push(sql`c.iso_alpha2 = ${input.sellerCountry}`);
    if (input.countryOfOrigin) where.push(sql`p.country_of_origin_id = (select id from countries where iso_alpha2 = ${input.countryOfOrigin})`);
    if (input.destination) {
      where.push(sql`exists (
        select 1 from lanes l join countries d on d.id = l.destination_country_id
        where l.origin_country_id = c.id and l.enabled and d.marketplace_enabled and d.iso_alpha2 = ${input.destination})`);
    }
    if (input.currency) where.push(sql`v.currency_code = ${input.currency}`);
    // All configured currencies use 2 minor units; revisit if a 0- or 3-decimal currency is added.
    if (input.minPrice) where.push(sql`v.min_price >= ${parseDecimalToMinor(input.minPrice, 2)}`);
    if (input.maxPrice) where.push(sql`v.min_price <= ${parseDecimalToMinor(input.maxPrice, 2)}`);
    if (input.inStock === true) where.push(sql`v.available > 0`);

    const rank = tsq ? sql`(ts_rank(p.search_vector, to_tsquery('english', ${tsq})) + similarity(p.title, ${q!}))` : sql`0`;
    const order = {
      relevance: tsq ? sql`rank desc, p.published_at desc` : sql`p.published_at desc`,
      newest: sql`p.published_at desc`,
      price_asc: sql`v.min_price asc, p.published_at desc`,
      price_desc: sql`v.min_price desc, p.published_at desc`,
    }[input.sort];

    const result = await this.db.execute<{
      id: string;
      title: string;
      short_description: string;
      min_price: string;
      currency_code: string;
      available: number;
      image_media_id: string | null;
      store_slug: string;
      store_name: string;
      seller_country: string;
      seller_country_name: string;
      total: number;
    }>(sql`
      select p.id, p.title, p.short_description, v.min_price, v.currency_code, v.available,
             (select pi.media_id from product_images pi where pi.product_id = p.id order by pi.sort_order limit 1) as image_media_id,
             sf.slug as store_slug, sf.display_name as store_name, c.iso_alpha2 as seller_country, c.name as seller_country_name,
             ${rank} as rank, count(*) over()::int as total
      from products p
      join seller_profiles sp on sp.id = p.seller_profile_id
      join users u on u.id = sp.user_id
      join seller_storefronts sf on sf.seller_profile_id = sp.id
      join countries c on c.id = sp.country_id
      join lateral (
        select min(pv.price_minor) as min_price, min(pv.currency_code) as currency_code,
               coalesce(sum(i.quantity_on_hand - i.quantity_reserved), 0)::int as available
        from product_variants pv left join inventory i on i.variant_id = pv.id
        where pv.product_id = p.id and not pv.archived
      ) v on v.min_price is not null
      where ${sql.join(where, sql` and `)}
      order by ${order}
      limit ${input.pageSize} offset ${(input.page - 1) * input.pageSize}`);

    return {
      total: result.rows[0]?.total ?? 0,
      hits: result.rows.map((r) => ({
        id: r.id,
        title: r.title,
        shortDescription: r.short_description,
        minPriceMinor: BigInt(r.min_price),
        currencyCode: r.currency_code,
        available: r.available,
        imageMediaId: r.image_media_id,
        storeSlug: r.store_slug,
        storeName: r.store_name,
        sellerCountry: r.seller_country,
        sellerCountryName: r.seller_country_name,
      })),
    };
  }
}
