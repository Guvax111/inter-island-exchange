'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { OrderSummary } from '@/lib/types';

export default function SellerOrdersPage() {
  const { data, isLoading } = useQuery({ queryKey: ['sales'], queryFn: () => api<{ items: OrderSummary[] }>('/me/sales') });
  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!data?.items.length) return <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">No orders yet.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Only prepare and ship orders once payment is confirmed. Orders waiting for payment are cancelled after 30 minutes if unpaid.</p>
      <ul className="divide-y rounded-lg border">
        {data.items.map((o) => (
          <li key={o.iieId}>
            <Link href={`/dashboard/seller/orders/${o.iieId}`} className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-muted/50">
              <div>
                <p className="font-mono text-sm font-semibold">{o.iieId}</p>
                <p className="text-sm text-muted-foreground">
                  {o.buyerFirstName} · {o.route} · {new Date(o.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold">{o.total.formatted}</p>
                <p className="text-sm text-muted-foreground">{o.statusLabel}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
