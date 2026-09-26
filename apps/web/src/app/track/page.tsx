'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { useMe } from '@/lib/session';
import type { OrderSummary } from '@/lib/types';

const IN_TRANSIT = ['PREPARING_SHIPMENT', 'PICKUP_SCHEDULED', 'PICKED_UP', 'EXPORT_PROCESSING', 'IN_TRANSIT', 'ARRIVED_DESTINATION', 'CUSTOMS_PROCESSING', 'CUSTOMS_HOLD', 'CUSTOMS_CLEARED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

/** Tracking for signed-in buyers: shipments are private to the buyer, so tracking opens the order page. */
export default function TrackPage() {
  const { data: me, isLoading } = useMe();
  const router = useRouter();
  const [id, setId] = useState('');
  const orders = useQuery({ queryKey: ['orders'], enabled: !!me, queryFn: () => api<{ items: OrderSummary[] }>('/me/orders').then((r) => r.items) });
  const moving = orders.data?.filter((o) => IN_TRANSIT.includes(o.status)) ?? [];

  return (
    <section className="container max-w-2xl py-12">
      <h1 className="text-3xl font-bold text-ocean-900">Track a shipment</h1>
      <p className="mt-2 text-muted-foreground">Every shipment is tracked under its IIE transaction ID, for example IIE-SLU-SVG-000001.</p>
      {isLoading ? null : !me ? (
        <div className="mt-6 rounded-lg border p-4">
          <p>Sign in to follow your orders. Tracking details, including your address and proof of delivery, are only shown to you.</p>
          <Button asChild className="mt-3">
            <Link href="/login?next=/track">Sign in</Link>
          </Button>
        </div>
      ) : (
        <>
          <form
            className="mt-6 flex max-w-md items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (id.trim()) router.push(`/orders/${encodeURIComponent(id.trim().toUpperCase())}`);
            }}
          >
            <div className="flex-1 space-y-1">
              <Label htmlFor="iie-id">IIE transaction ID</Label>
              <Input id="iie-id" placeholder="IIE-SLU-SVG-000001" value={id} onChange={(e) => setId(e.target.value)} />
            </div>
            <Button type="submit">Track</Button>
          </form>
          <h2 className="mt-8 text-lg font-semibold">Your shipments</h2>
          {moving.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              None on the way right now. <Link href="/orders" className="underline">All my orders</Link>
            </p>
          ) : (
            <ul className="mt-2 divide-y rounded-lg border">
              {moving.map((o) => (
                <li key={o.iieId}>
                  <Link href={`/orders/${o.iieId}`} className="flex items-center justify-between gap-3 p-3 hover:bg-muted">
                    <span className="font-mono text-sm font-semibold">{o.iieId}</span>
                    <span className="text-sm">{o.statusLabel}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
