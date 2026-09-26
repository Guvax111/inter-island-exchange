'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/session';
import type { TariffResolution } from '@/lib/types';
import { TariffCard } from './tariff-card';

/**
 * Under the seller's HS code field: the official description and duties for each country the seller ships to,
 * for the product's country of origin, so the seller can check the code before submitting.
 */
export function HsHelper({ hsCode, origin, originName }: { hsCode: string; origin: string; originName?: string }) {
  const { data: me } = useMe();
  const [code, setCode] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setCode(hsCode.replace(/[\s.]/g, '')), 400);
    return () => clearTimeout(t);
  }, [hsCode]);
  const valid = /^\d{6,10}$/.test(code);
  const home = me?.user.country.code;
  const { data: destinations } = useQuery({
    queryKey: ['lanes-from', home],
    enabled: !!home,
    queryFn: () => api<{ items: { origin: string; destination: string; destinationName: string }[] }>('/lanes').then((r) => r.items.filter((l) => l.origin === home)),
  });
  const { data: results } = useQuery({
    queryKey: ['hs-helper', code, origin, destinations?.map((d) => d.destination).join()],
    enabled: valid && !!destinations?.length,
    queryFn: () =>
      Promise.all(
        destinations!.map(async (d) => ({ d, t: (await api<{ result: TariffResolution | null }>(`/tariffs/lookup?country=${d.destination}&hs=${code}${origin ? `&origin=${origin}` : ''}`)).result })),
      ),
  });
  if (!valid || !results) return null;
  return (
    <div className="space-y-2">
      {results.map(({ d, t }) =>
        t ? <TariffCard key={d.destination} t={t} originName={originName} /> : <p key={d.destination} className="text-xs text-muted-foreground">No duty information for {d.destinationName} yet.</p>,
      )}
      <p className="text-xs">
        Not the right description? <Link href={`/tariffs?country=${destinations?.[0]?.destination ?? ''}`} className="underline" target="_blank">Search the tariff</Link> or ask your customs broker.
      </p>
    </div>
  );
}
