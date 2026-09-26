'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { RequireSignIn } from '@/components/account/require-signin';
import { api } from '@/lib/api';
import type { OrderSummary } from '@/lib/types';

export default function OrdersPage() {
  return (
    <section className="container max-w-4xl py-8">
      <h1 className="text-3xl font-bold text-ocean-900">My orders</h1>
      <RequireSignIn>{() => <OrderList />}</RequireSignIn>
    </section>
  );
}

function OrderList() {
  const { data, isLoading } = useQuery({ queryKey: ['orders'], queryFn: () => api<{ items: OrderSummary[] }>('/me/orders') });
  if (isLoading) return <p className="mt-4 text-muted-foreground">Loading…</p>;
  if (!data?.items.length) return <p className="mt-6 rounded-lg border border-dashed p-8 text-center text-muted-foreground">No orders yet. <Link href="/marketplace" className="underline">Shop the marketplace</Link>.</p>;
  return (
    <ul className="mt-6 divide-y rounded-lg border">
      {data.items.map((o) => (
        <li key={o.iieId}>
          <Link href={`/orders/${o.iieId}`} className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-muted/50">
            <div>
              <p className="font-mono text-sm font-semibold">{o.iieId}</p>
              <p className="text-sm text-muted-foreground">
                {o.seller.name} · {o.route} · {new Date(o.createdAt).toLocaleDateString()}
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
  );
}
