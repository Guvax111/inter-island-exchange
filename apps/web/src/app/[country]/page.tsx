import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { serverGet, type PublicCountry } from '@/lib/server-api';

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
          <h2 className="text-lg font-semibold">Local sellers and products</h2>
          <p className="mt-3 text-muted-foreground">
            Seller storefronts and product listings open in the next release. {country.marketplaceEnabled && 'Sellers can apply now.'}
          </p>
          {country.marketplaceEnabled && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/signup?type=SELLER">Become a Seller</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/signup?type=BUYER">Register as a Buyer</Link>
              </Button>
            </div>
          )}
        </div>
        <div className="rounded-lg border p-6 md:col-span-2">
          <h2 className="text-lg font-semibold">Shipping and logistics partners</h2>
          <p className="mt-3 text-muted-foreground">Shipping options and logistics partners for {country.name} will be listed here.</p>
        </div>
      </section>
    </>
  );
}
