import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BadgeCheck, Truck } from 'lucide-react';
import { AddToCart } from '@/components/marketplace/add-to-cart';
import { TariffCard, formatHs } from '@/components/tariffs/tariff-card';
import { RatingSummary } from '@/components/reviews/stars';
import { ReviewList } from '@/components/reviews/review-list';
import { serverGet } from '@/lib/server-api';
import type { PublicProduct } from '@/lib/types';

type Props = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f-]{36}$/i;

async function load(id: string) {
  return UUID.test(id) ? serverGet<PublicProduct>(`/products/${id}`, 30) : null;
}

export async function generateMetadata({ params }: Props) {
  const p = await load((await params).id);
  return { title: p?.title ?? 'Product not found', description: p?.shortDescription };
}

export default async function ProductPage({ params }: Props) {
  const product = await load((await params).id);
  if (!product) notFound();
  const [cover, ...rest] = product.images;
  const facts: [string, string | null][] = [
    ['Brand', product.brand],
    ['Country of origin', product.countryOfOrigin?.name ?? null],
    ['HS code', product.hsCode ? formatHs(product.hsCode) : null],
    ['Weight', product.weightGrams ? `${(product.weightGrams / 1000).toFixed(2)} kg` : null],
    ['Package size', product.dimensionsMm ? `${product.dimensionsMm.length / 10} × ${product.dimensionsMm.width / 10} × ${product.dimensionsMm.height / 10} cm` : null],
    ...Object.entries(product.attributes),
  ];

  return (
    <section className="container py-8">
      <nav className="mb-4 text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/marketplace" className="underline">Marketplace</Link>
        {product.categoryPath.map((c) => (
          <span key={c.slug}>
            {' / '}
            <Link href={`/marketplace?category=${c.slug}`} className="underline">{c.name}</Link>
          </span>
        ))}
      </nav>
      <div className="grid gap-8 md:grid-cols-2">
        <div className="space-y-3">
          {cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover.url} alt={cover.altText} className="aspect-square w-full rounded-lg border object-cover" />
          )}
          {rest.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {rest.map((img) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={img.id} src={img.url} alt={img.altText} loading="lazy" className="aspect-square w-full rounded-md border object-cover" />
              ))}
            </div>
          )}
        </div>
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-ocean-900 md:text-3xl">{product.title}</h1>
            <p className="mt-2 text-muted-foreground">{product.shortDescription}</p>
            <p className="mt-2 text-sm">
              <a href="#reviews" className="hover:underline">
                <RatingSummary rating={product.rating} />
              </a>
            </p>
            <Link href={`/seller/${product.seller.slug}`} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-ocean-700 underline">
              <BadgeCheck className="h-4 w-4" aria-hidden /> {product.seller.name}, {product.seller.countryName}
            </Link>
            {product.seller.rating && (
              <p className="mt-1 text-xs text-muted-foreground">
                Seller rating {product.seller.rating.average.toFixed(1)} / 5 from {product.seller.rating.count} {product.seller.rating.count === 1 ? 'review' : 'reviews'}
              </p>
            )}
          </div>
          <AddToCart product={product} />
          <div className="flex gap-2 rounded-lg bg-muted p-3 text-sm">
            <Truck className="h-5 w-5 shrink-0 text-ocean-700" aria-hidden />
            <p>
              Ships from {product.shipsFrom.name}
              {product.shipsTo.length ? ` to ${product.shipsTo.map((d) => d.name).join(', ')}` : '. Not currently shipping to other countries'}.
            </p>
          </div>
        </div>
      </div>
      <div className="mt-10 grid gap-8 md:grid-cols-2">
        <div>
          <h2 className="text-lg font-semibold">Description</h2>
          <p className="mt-2 whitespace-pre-line text-slate-700">{product.description}</p>
        </div>
        <div>
          <h2 className="text-lg font-semibold">Details</h2>
          <dl className="mt-2 divide-y rounded-lg border text-sm">
            {facts
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="grid grid-cols-2 gap-2 p-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
          {product.importInfo.length > 0 && (
            <section className="mt-6">
              <h2 className="text-lg font-semibold">Import duties and taxes</h2>
              <div className="mt-2 space-y-3">
                {product.importInfo.map(({ destination, tariff }) =>
                  tariff ? (
                    <TariffCard key={destination.code} t={tariff} originName={product.countryOfOrigin?.name} />
                  ) : (
                    <p key={destination.code} className="text-sm text-muted-foreground">
                      Importing into {destination.name}: no duty information yet.
                    </p>
                  ),
                )}
              </div>
              <Link href="/tariffs" className="mt-2 inline-block text-sm underline">
                Look up other HS codes
              </Link>
            </section>
          )}
        </div>
      </div>
      <section id="reviews" className="mt-10 max-w-3xl scroll-mt-24">
        <h2 className="text-lg font-semibold">Reviews</h2>
        <p className="mt-1 text-sm text-muted-foreground">From buyers who ordered this product. IIE checks every review before it is published.</p>
        <div className="mt-2">
          <ReviewList reviews={product.reviews} />
        </div>
      </section>
    </section>
  );
}
