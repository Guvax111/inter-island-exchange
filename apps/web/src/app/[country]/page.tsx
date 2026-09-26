import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ProductGrid } from '@/components/marketplace/product-card';
import { serverGet, type PublicCountry } from '@/lib/server-api';
import type { SearchResult, SellerCard } from '@/lib/types';

type Props = { params: Promise<{ country: string }> };

// Country pages come from the country table: adding a country in the admin adds its page. No per-country code.
async function load(slug: string) {
  if (!/^[a-z0-9-]{2,50}$/.test(slug)) return null;
  const country = await serverGet<PublicCountry>(`/countries/${slug}`);
  // Only slugs resolve here; ISO codes (e.g. /lc) are not public page URLs.
  return country && country.slug === slug ? country : null;
}

export async function generateMetadata({ params }: Props) {
  const country = await load((await params).country);
  return { title: country ? `${country.name} marketplace` : 'Not found' };
}

export default async function CountryPage({ params }: Props) {
  const country = await load((await params).country);
  if (!country) notFound();
  const tagline = typeof country.info.tagline === 'string' ? country.info.tagline : null;
  const lanes = country.lanes ?? [];
  const [sellers, latest, partners] = await Promise.all([
    serverGet<{ items: SellerCard[] }>(`/sellers?country=${country.code}`, 60),
    serverGet<SearchResult>(`/products?sellerCountry=${country.code}&sort=newest&pageSize=8`, 60),
    serverGet<{ logisticsPartners: string[]; customsBrokers: string[] }>(`/countries/${country.code}/partners`, 300),
  ]);

  return (
    <>
      <section className="bg-ocean-800 text-white">
        <div className="container py-12">
          <Badge className="bg-white/15">{country.marketplaceEnabled ? 'Marketplace open' : 'Coming soon'}</Badge>
          <h1 className="mt-3 text-4xl font-bold">{country.name}</h1>
          {tagline && <p className="mt-2 text-lg text-ocean-100">{tagline}</p>}
          <p className="mt-4 text-ocean-100">
            Prices shown in {country.currency.name} ({country.currency.code}, {country.currency.symbol})
          </p>
        </div>
      </section>
      <section className="container grid gap-6 py-10 md:grid-cols-2">
        <div className="rounded-lg border p-6">
          <h2 className="text-lg font-semibold">Trade routes</h2>
          {lanes.length ? (
            <ul className="mt-3 space-y-2">
              {lanes.map((l) => (
                <li key={`${l.origin}-${l.destination}`} className="flex items-center gap-2">
                  {l.originName} <ArrowRight className="h-4 w-4" aria-label="to" /> {l.destinationName}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-muted-foreground">No trade routes are open for {country.name} yet.</p>
          )}
        </div>
        <div className="rounded-lg border p-6">
          <h2 className="text-lg font-semibold">Local sellers</h2>
          {sellers?.items.length ? (
            <ul className="mt-3 space-y-2">
              {sellers.items.map((s) => (
                <li key={s.slug}>
                  <Link href={`/seller/${s.slug}`} className="text-ocean-700 underline">
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-muted-foreground">No sellers from {country.name} are live yet.</p>
          )}
          {country.marketplaceEnabled && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href="/signup?type=SELLER">Become a Seller</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/signup?type=BUYER">Register as a Buyer</Link>
              </Button>
            </div>
          )}
        </div>
        <div className="md:col-span-2">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Products from {country.name}</h2>
            <Link href={`/marketplace?sellerCountry=${country.code}`} className="text-sm text-ocean-700 underline">
              See all
            </Link>
          </div>
          <ProductGrid products={latest?.items ?? []} empty={`No products from ${country.name} are listed yet.`} />
        </div>
        <div className="rounded-lg border p-6 md:col-span-2">
          <h2 className="text-lg font-semibold">Shipping and logistics partners</h2>
          {partners && (partners.logisticsPartners.length || partners.customsBrokers.length) ? (
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium">Logistics partners</dt>
                <dd className="text-muted-foreground">{partners.logisticsPartners.join(', ') || 'To be announced'}</dd>
              </div>
              <div>
                <dt className="font-medium">Customs brokers in {country.name}</dt>
                <dd className="text-muted-foreground">{partners.customsBrokers.join(', ') || 'To be announced'}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-muted-foreground">IIE is selecting its logistics partners for {country.name}. They will be listed here once announced.</p>
          )}
        </div>
      </section>
    </>
  );
}
