import { notFound } from 'next/navigation';
import { BadgeCheck, MapPin } from 'lucide-react';
import { Pagination } from '@/components/marketplace/pagination';
import { ProductGrid } from '@/components/marketplace/product-card';
import { SaveSellerButton } from '@/components/marketplace/save-seller';
import { RatingSummary } from '@/components/reviews/stars';
import { ReviewList } from '@/components/reviews/review-list';
import { serverGet } from '@/lib/server-api';
import type { SearchResult, Storefront } from '@/lib/types';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> };

async function load(slug: string) {
  return /^[a-z0-9-]{3,60}$/.test(slug) ? serverGet<Storefront>(`/sellers/${slug}`, 60) : null;
}

export async function generateMetadata({ params }: Props) {
  const s = await load((await params).slug);
  return { title: s?.name ?? 'Seller not found', description: s?.description.slice(0, 160) };
}

export default async function StorefrontPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const store = await load(slug);
  if (!store) notFound();
  const page = String(Math.max(1, Number((await searchParams).page) || 1));
  const products = await serverGet<SearchResult>(`/products?seller=${slug}&sort=newest&page=${page}`, 30);

  return (
    <>
      <section className="border-b bg-ocean-50">
        <div className="container flex flex-col gap-4 py-8 sm:flex-row sm:items-center">
          {store.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={store.logoUrl} alt="" className="h-20 w-20 rounded-full border bg-white object-cover" />
          ) : (
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-ocean-700 text-2xl font-bold text-white">{store.name.slice(0, 1)}</span>
          )}
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-ocean-900">{store.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-1 font-medium text-ocean-800">
                <BadgeCheck className="h-4 w-4" aria-hidden /> Verified by IIE
              </span>
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <MapPin className="h-4 w-4" aria-hidden /> Ships from {store.shippingOrigin}
              </span>
              <RatingSummary rating={store.rating} empty="No reviews yet" />
              <span className="text-muted-foreground">
                {store.completedTransactions ? `${store.completedTransactions} completed ${store.completedTransactions === 1 ? 'order' : 'orders'}` : 'New seller on IIE'}
              </span>
            </p>
          </div>
          <SaveSellerButton slug={store.slug} />
        </div>
      </section>
      <section className="container grid gap-8 py-8 lg:grid-cols-[1fr_300px]">
        <div>
          {store.description && <p className="mb-6 whitespace-pre-line text-slate-700">{store.description}</p>}
          <h2 className="mb-3 text-xl font-semibold">Products</h2>
          <ProductGrid products={products?.items ?? []} empty="This seller has no products listed yet." />
          {products && <Pagination page={products.page} pageSize={products.pageSize} total={products.total} params={{}} basePath={`/seller/${slug}`} />}
          <h2 id="reviews" className="mb-1 mt-10 text-xl font-semibold">Reviews</h2>
          <p className="text-sm text-muted-foreground">IIE checks every review before it is published.</p>
          <ReviewList reviews={store.reviews} />
        </div>
        <aside className="space-y-4 text-sm">
          {store.categories.length > 0 && (
            <div className="rounded-lg border p-4">
              <h2 className="font-semibold">Categories</h2>
              <p className="mt-1 text-muted-foreground">{store.categories.map((c) => c.name).join(', ')}</p>
            </div>
          )}
          <div className="rounded-lg border p-4">
            <h2 className="font-semibold">Ships to</h2>
            <p className="mt-1 text-muted-foreground">{store.shipsTo.length ? store.shipsTo.map((c) => c.name).join(', ') : 'Not shipping to other countries yet'}</p>
          </div>
          <div className="rounded-lg border p-4">
            <h2 className="font-semibold">Returns</h2>
            <p className="mt-1 whitespace-pre-line text-muted-foreground">{store.returnPolicy || 'The seller has not published a return policy yet.'}</p>
          </div>
          {store.storePolicies && (
            <div className="rounded-lg border p-4">
              <h2 className="font-semibold">Store policies</h2>
              <p className="mt-1 whitespace-pre-line text-muted-foreground">{store.storePolicies}</p>
            </div>
          )}
        </aside>
      </section>
    </>
  );
}
