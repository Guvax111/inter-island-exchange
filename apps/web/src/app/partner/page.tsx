'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import type { PartnerShipmentSummary } from '@/lib/types';

export default function PartnerHome() {
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['partner-shipments'],
    refetchInterval: 60_000,
    queryFn: () => api<{ partners: { id: string; name: string; kind: string }[]; items: PartnerShipmentSummary[] }>('/partner/shipments'),
  });
  const items = (data?.items ?? []).filter((i) => showAll || i.open);
  return (
    <section className="container max-w-4xl py-8">
      <h1 className="text-2xl font-bold text-ocean-900">Partner portal</h1>
      <p className="text-muted-foreground">{data?.partners.map((p) => `${p.name} (${p.kind === 'LOGISTICS' ? 'logistics partner' : 'customs broker'})`).join(' · ')}</p>
      <div className="mt-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{showAll ? 'All shipments' : 'Shipments in progress'}</h2>
        <button className="text-sm underline" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show in progress only' : 'Show all, including delivered'}
        </button>
      </div>
      {isLoading ? (
        <p className="mt-4 text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-muted-foreground">No shipments {showAll ? 'yet' : 'in progress'}.</p>
      ) : (
        <ul className="mt-3 divide-y rounded-lg border">
          {items.map((s) => (
            <li key={s.iieId}>
              <Link href={`/partner/shipments/${s.iieId}`} className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-muted">
                <div>
                  <p className="font-mono font-semibold">{s.iieId}</p>
                  <p className="text-sm text-muted-foreground">
                    {s.pickupCity} → {s.deliveryCity} · {s.route}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {s.actionNeeded && <Badge>Your move</Badge>}
                  <span className="text-sm">{s.statusLabel}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
