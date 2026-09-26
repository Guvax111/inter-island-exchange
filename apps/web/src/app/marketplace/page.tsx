import { Pagination } from '@/components/marketplace/pagination';
import { ProductGrid } from '@/components/marketplace/product-card';
import { Button } from '@/components/ui/button';
import { serverGet, type PublicCountry } from '@/lib/server-api';
import { flattenCategories, type CategoryNode, type SearchResult } from '@/lib/types';

export const metadata = { title: 'Marketplace' };
export const dynamic = 'force-dynamic';

const FILTERS = ['q', 'category', 'sellerCountry', 'destination', 'minPrice', 'maxPrice', 'inStock', 'sort', 'page'] as const;
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function MarketplacePage({ searchParams }: Props) {
  const raw = await searchParams;
  const params: Record<string, string> = {};
  for (const key of FILTERS) {
    const v = raw[key];
    if (typeof v === 'string' && v.trim()) params[key] = v.trim();
  }
  const [result, categoriesRes, countriesRes] = await Promise.all([
    serverGet<SearchResult>(`/products?${new URLSearchParams(params)}`, 30).catch(() => null),
    serverGet<{ items: CategoryNode[] }>('/categories', 300),
    serverGet<{ items: PublicCountry[] }>('/countries', 300),
  ]);
  const categories = flattenCategories(categoriesRes?.items ?? []);
  const open = (countriesRes?.items ?? []).filter((c) => c.marketplaceEnabled);
  const { page: _p, ...keep } = params;

  return (
    <section className="container py-8">
      <h1 className="text-3xl font-bold text-ocean-900">Marketplace</h1>
      <p className="mt-1 text-muted-foreground">Products from IIE-verified sellers across CARICOM.</p>

      <form method="get" className="mt-6 grid gap-3 rounded-lg border bg-muted/40 p-4 sm:grid-cols-2 lg:grid-cols-4" role="search">
        <label className="sm:col-span-2">
          <span className="text-sm font-medium">Search</span>
          <input name="q" defaultValue={params.q} placeholder="e.g. diapers" className="mt-1 h-10 w-full rounded-md border px-3" />
        </label>
        <Select name="category" label="Category" value={params.category} options={[['', 'All categories'], ...categories.map((c) => [c.slug, c.label] as [string, string])]} />
        <Select name="sort" label="Sort by" value={params.sort} options={[['relevance', 'Best match'], ['newest', 'Newest'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low']]} />
        <Select name="sellerCountry" label="Seller country" value={params.sellerCountry} options={[['', 'Any'], ...open.map((c) => [c.code, c.name] as [string, string])]} />
        <Select name="destination" label="Ships to" value={params.destination} options={[['', 'Anywhere'], ...open.map((c) => [c.code, c.name] as [string, string])]} />
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="text-sm font-medium">Min price</span>
            <input name="minPrice" inputMode="decimal" defaultValue={params.minPrice} className="mt-1 h-10 w-full rounded-md border px-3" />
          </label>
          <label>
            <span className="text-sm font-medium">Max price</span>
            <input name="maxPrice" inputMode="decimal" defaultValue={params.maxPrice} className="mt-1 h-10 w-full rounded-md border px-3" />
          </label>
        </div>
        <div className="flex items-end justify-between gap-3">
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" name="inStock" value="true" defaultChecked={params.inStock === 'true'} /> In stock only
          </label>
          <Button type="submit">Search</Button>
        </div>
      </form>

      <div className="mt-6">
        {result === null ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">Some filters are not valid. Check the prices (e.g. 12.50) and try again.</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted-foreground">
              {result.total} {result.total === 1 ? 'product' : 'products'}
            </p>
            <ProductGrid products={result.items} empty="No products match your search yet. Try fewer filters." />
            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} params={keep} basePath="/marketplace" />
          </>
        )}
      </div>
    </section>
  );
}

function Select({ name, label, value, options }: { name: string; label: string; value?: string; options: [string, string][] }) {
  return (
    <label>
      <span className="text-sm font-medium">{label}</span>
      <select name={name} defaultValue={value ?? options[0]?.[0]} className="mt-1 h-10 w-full rounded-md border bg-white px-3">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
