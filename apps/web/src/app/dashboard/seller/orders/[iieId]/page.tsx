'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CostBreakdown } from '@/components/orders/cost-breakdown';
import { OrderTimeline } from '@/components/orders/order-timeline';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import type { OrderDetail } from '@/lib/types';

export default function SellerOrderPage() {
  const { iieId } = useParams<{ iieId: string }>();
  const { data: order, isLoading } = useQuery({ queryKey: ['sale', iieId], queryFn: () => api<OrderDetail>(`/me/sales/${iieId}`) });
  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!order) return <p className="text-muted-foreground">Order not found.</p>;
  const next =
    order.status === 'AWAITING_PAYMENT'
      ? 'Waiting for the buyer to pay. Do not prepare or ship yet.'
      : order.status === 'CANCELLED'
        ? 'This order was cancelled. Nothing to do.'
        : 'IIE will tell you what to do next.';
  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/seller/orders" className="text-sm underline">All orders</Link>
        <h2 className="mt-1 font-mono text-2xl font-bold text-ocean-900">{order.iieId}</h2>
        <p className="text-muted-foreground">
          {order.buyer.firstName} in {order.deliveryAddress.city}, {order.deliveryAddress.country}
        </p>
      </div>
      <div className="rounded-lg border-l-4 border-ocean-600 bg-ocean-50 p-4" role="status">
        <p className="font-semibold">{order.statusLabel}</p>
        <p className="text-sm">{next}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Items to supply</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {order.items.map((i) => (
                  <li key={i.sku} className="flex justify-between gap-4 py-2">
                    <span>
                      {i.quantity} × {i.title} ({i.variantName}) <span className="text-muted-foreground">SKU {i.sku}</span>
                    </span>
                    <span>{i.lineTotal.formatted}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <OrderTimeline order={order} />
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Amounts</CardTitle>
          </CardHeader>
          <CardContent>
            <CostBreakdown {...order.amounts} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
