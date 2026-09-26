'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { TariffCard, formatHs } from '@/components/tariffs/tariff-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import type { TariffResolution } from '@/lib/types';

interface Line { hsCode: string; description: string; generalDutyPercent: number | null; caricomDutyPercent: number | null; vatPercent: number | null; rateText: string | null; restriction: string }
interface Coverage { country: string; name: string; lines: number; schedule: string; publisher: string; effectiveFrom: string }

export default function TariffsPage() {
  return (
    <Suspense>
      <Tariffs />
    </Suspense>
  );
}

/** Public lookup of HS descriptions, duties, VAT and import restrictions per CARICOM country. */
function Tariffs() {
  const params = useSearchParams();
  const [country, setCountry] = useState(params.get('country') || 'VC');
  const [q, setQ] = useState('');
  const [origin, setOrigin] = useState('');
  const [search, setSearch] = useState<{ country: string; q: string; origin: string } | null>(null);
  const countries = useQuery({ queryKey: ['countries'], queryFn: () => api<{ items: { code: string; name: string; marketplaceEnabled: boolean }[] }>('/countries').then((r) => r.items) });
  const origins = useQuery({ queryKey: ['countries-origins'], queryFn: () => api<{ items: { code: string; name: string }[] }>('/countries?scope=origins').then((r) => r.items) });
  const coverage = useQuery({ queryKey: ['tariff-coverage'], queryFn: () => api<{ items: Coverage[] }>('/tariffs/coverage').then((r) => r.items) });
  const digits = search?.q.replace(/[\s.]/g, '') ?? '';
  const results = useQuery({
    queryKey: ['tariff-search', search],
    enabled: !!search,
    queryFn: async () => {
      const lookup = /^\d{4,12}$/.test(digits) ? (await api<{ result: TariffResolution | null }>(`/tariffs/lookup?country=${search!.country}&hs=${digits}${search!.origin ? `&origin=${search!.origin}` : ''}`)).result : null;
      const list = (await api<{ items: Line[] }>(`/tariffs/search?country=${search!.country}&q=${encodeURIComponent(search!.q)}`)).items;
      return { lookup, list };
    },
  });
  const covered = coverage.data?.find((c) => c.country === country);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (q.trim().length >= 2) setSearch({ country, q: q.trim(), origin });
  }

  return (
    <section className="container max-w-4xl py-10">
      <h1 className="text-3xl font-bold text-ocean-900">Duties &amp; Tariffs</h1>
      <p className="mt-2 text-muted-foreground">
        Look up a product’s HS code, its description, and the import duty and VAT in the CARICOM country it is going to. Goods of CARICOM origin usually pay a different (often zero) duty from goods made
        elsewhere. Duties and taxes are paid by the buyer on arrival; customs sets the final amount.
      </p>

      <form onSubmit={submit} className="mt-6 grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="t-country">Importing into</Label>
          <select id="t-country" className="w-full rounded border p-2 text-sm" value={country} onChange={(e) => setCountry(e.target.value)}>
            {countries.data?.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="t-origin">Made in (optional)</Label>
          <select id="t-origin" className="w-full rounded border p-2 text-sm" value={origin} onChange={(e) => setOrigin(e.target.value)}>
            <option value="">—</option>
            {origins.data?.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="t-q">HS code or description</Label>
          <Input id="t-q" placeholder="e.g. 9619.00 or diapers" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button type="submit">Search</Button>
      </form>

      <p className="mt-3 text-sm text-muted-foreground">
        {covered
          ? `${covered.name}: ${covered.schedule} (${covered.publisher}), ${covered.lines.toLocaleString()} lines, in force from ${new Date(covered.effectiveFrom).toLocaleDateString()}.`
          : 'IIE has not yet published a tariff schedule for this country. Lookups show IIE’s duty estimate where one is configured.'}
      </p>

      {results.data && (
        <div className="mt-6 space-y-4">
          {results.data.lookup && <TariffCard t={results.data.lookup} originName={origins.data?.find((o) => o.code === search?.origin)?.name} />}
          {results.data.list.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1 pr-2">HS code</th>
                  <th className="py-1 pr-2">Description</th>
                  <th className="py-1 pr-2 text-right">CARICOM</th>
                  <th className="py-1 pr-2 text-right">Other</th>
                  <th className="py-1 text-right">VAT</th>
                </tr>
              </thead>
              <tbody>
                {results.data.list.map((l) => (
                  <tr key={l.hsCode} className="border-b align-top">
                    <td className="py-1 pr-2 font-mono">{formatHs(l.hsCode)}</td>
                    <td className="py-1 pr-2">
                      {l.description}
                      {l.restriction !== 'NONE' && <span className="ml-1 text-xs font-semibold text-red-800">{l.restriction === 'PROHIBITED' ? 'Prohibited' : 'Licence required'}</span>}
                    </td>
                    <td className="py-1 pr-2 text-right">{l.caricomDutyPercent ?? '—'}{l.caricomDutyPercent !== null && '%'}</td>
                    <td className="py-1 pr-2 text-right">{l.generalDutyPercent ?? l.rateText ?? '—'}{l.generalDutyPercent !== null && '%'}</td>
                    <td className="py-1 text-right">{l.vatPercent ?? '—'}{l.vatPercent !== null && '%'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            !results.data.lookup && <p className="text-sm text-muted-foreground">Nothing found.</p>
          )}
        </div>
      )}
    </section>
  );
}
