'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { RequireSignIn } from '@/components/account/require-signin';
import { FormError } from '@/components/forms/field';
import { CostBreakdown } from '@/components/orders/cost-breakdown';
import { OrderTimeline } from '@/components/orders/order-timeline';
import { PaymentCountdown } from '@/components/orders/payment-countdown';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, errorMessage } from '@/lib/api';
import type { OrderDetail } from '@/lib/types';

export default function OrderPage() {
  return (
    <section className="container max-w-5xl py-8">
      <RequireSignIn>{() => <Order />}</RequireSignIn>
    </section>
  );
}

function Order() {
  const { iieId } = useParams<{ iieId: string }>();
  const qc = useQueryClient();
  const { data: order, isLoading, error: loadError } = useQuery({ queryKey: ['order', iieId], queryFn: () => api<OrderDetail>(`/me/orders/${iieId}`) });
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (loadError || !order) return <p className="text-muted-foreground">Order not found. <Link href="/orders" className="underline">My orders</Link></p>;

  async function cancel() {
    if (!confirm('Cancel this order? The reserved items will be released.')) return;
    setError(null);
    try {
      qc.setQueryData(['order', iieId], await api<OrderDetail>(`/me/orders/${iieId}/cancel`, { method: 'POST', body: {} }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/orders" className="underline">My orders</Link>
        </p>
        <h1 className="mt-1 font-mono text-2xl font-bold text-ocean-900 sm:text-3xl">{order.iieId}</h1>
        <p className="text-muted-foreground">
          From <Link href={`/seller/${order.seller.slug}`} className="underline">{order.seller.name}</Link> · placed {new Date(order.createdAt).toLocaleString()}
        </p>
      </div>

      {order.status === 'AWAITING_PAYMENT' && order.paymentDueAt && (
        <div className="rounded-lg border-l-4 border-coral-400 bg-orange-50 p-4" role="status">
          <p className="font-semibold">Waiting for payment · items reserved, <PaymentCountdown dueAt={order.paymentDueAt} /></p>
          <p className="mt-1 text-sm">
            Online payment through IIE&apos;s licensed payment partner opens in the next release. If the order is not paid in time it is cancelled automatically and you are not charged.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled title="Payments open in the next release">Pay now — coming soon</Button>
            {order.canCancel && (
              <Button size="sm" variant="outline" onClick={cancel}>
                Cancel order
              </Button>
            )}
          </div>
          <FormError message={error} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Where your order is</CardTitle>
            </CardHeader>
            <CardContent>
              <OrderTimeline order={order} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Items</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {order.items.map((i) => (
                  <li key={i.sku} className="flex justify-between gap-4 py-2">
                    <span>
                      {i.quantity} × {i.title} <span className="text-muted-foreground">({i.variantName})</span>
                    </span>
                    <span className="font-medium">{i.lineTotal.formatted}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-muted-foreground">
                Delivering to {[order.deliveryAddress.line1, order.deliveryAddress.city, order.deliveryAddress.country].filter(Boolean).join(', ')}
              </p>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Cost</CardTitle>
          </CardHeader>
          <CardContent>
            <CostBreakdown {...order.amounts} dutiesEstimate={order.amounts.dutiesEstimate} />
            <p className="mt-3 text-xs text-muted-foreground">Prices were fixed when you placed the order.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
