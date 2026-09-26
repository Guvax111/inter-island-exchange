import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { serverGet, type PublicCountry } from '@/lib/server-api';

export const metadata = { title: 'Countries' };
// Rendered per request from live country configuration (the API response is cached for 60s), so builds do not need the API.
export const dynamic = 'force-dynamic';

export default async function CountriesPage() {
  const data = await serverGet<{ items: PublicCountry[] }>('/countries');
  const items = data?.items ?? [];
  const open = items.filter((c) => c.marketplaceEnabled);
  const upcoming = items.filter((c) => !c.marketplaceEnabled);
  return (
    <section className="container py-12">
      <h1 className="text-3xl font-bold text-ocean-900">Countries</h1>
      <p className="mt-3 max-w-2xl text-lg text-muted-foreground">
        One marketplace for the whole region. Each country has its own currency, rules and partners, all managed on the same platform.
      </p>
      <h2 className="mt-10 text-xl font-semibold">Open now</h2>
      <CountryGrid items={open} />
      <h2 className="mt-10 text-xl font-semibold">Coming soon</h2>
      <CountryGrid items={upcoming} />
    </section>
  );
}

function CountryGrid({ items }: { items: PublicCountry[] }) {
  return (
    <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((c) => (
        <li key={c.code}>
          <Link href={`/${c.slug}`} className="block h-full rounded-lg border p-5 transition hover:border-ocean-600 hover:shadow-md">
            <div className="flex items-start justify-between gap-2">
              <span className="font-semibold">{c.name}</span>
              <Badge variant={c.marketplaceEnabled ? 'default' : 'secondary'}>{c.marketplaceEnabled ? 'Open' : 'Coming soon'}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {c.currency.name} ({c.currency.symbol})
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
