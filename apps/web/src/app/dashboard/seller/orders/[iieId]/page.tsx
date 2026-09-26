'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FormError } from '@/components/forms/field';
import { HoursCountdown } from '@/components/orders/countdown';
import { CostBreakdown } from '@/components/orders/cost-breakdown';
import { OrderTimeline } from '@/components/orders/order-timeline';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import type { OrderDetail } from '@/lib/types';

export default function SellerOrderPage() {
  const { iieId } = useParams<{ iieId: string }>();
  const qc = useQueryClient();
  const { data: order, isLoading } = useQuery({ queryKey: ['sale', iieId], queryFn: () => api<OrderDetail>(`/me/sales/${iieId}`) });
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(path: 'confirm' | 'decline', body: object = {}) {
    setError(null);
    setBusy(true);
    try {
      await api(`/me/sales/${iieId}/${path}`, { method: 'POST', body });
      setDeclining(false);
      await qc.invalidateQueries({ queryKey: ['sale', iieId] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!order) return <p className="text-muted-foreground">Order not found.</p>;
  const next: Record<string, string> = {
    AWAITING_PAYMENT: 'Waiting for the buyer to pay. Do not prepare or ship yet.',
    PAYMENT_FAILED: 'The buyer’s payment did not go through; they can try again. Do not prepare or ship yet.',
    PAYMENT_PROCESSING: 'The buyer’s payment is being processed. Do not prepare or ship yet.',
    AWAITING_SELLER_CONFIRMATION: 'The buyer has paid. The payment provider holds the money until the order is complete. Confirm you can supply every item, or decline so the buyer is refunded.',
    SELLER_CONFIRMED: 'You confirmed this order. Prepare it for pickup; IIE will arrange the shipment with the logistics partner.',
    CANCELLED: 'This order was cancelled. Nothing to do.',
    REFUNDED: 'The buyer was refunded in full. Nothing to do; any stock was put back.',
    COMPLIANCE_HOLD: 'IIE is reviewing this order. Do not prepare or ship until IIE tells you.',
  };
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
        <p className="text-sm">{next[order.status] ?? 'IIE will tell you what to do next.'}</p>
        {order.status === 'AWAITING_SELLER_CONFIRMATION' && (
          <div className="mt-3 space-y-3">
            {order.sellerConfirmDueAt && (
              <p className="text-sm font-medium">
                Confirm within 48 hours of payment: <HoursCountdown dueAt={order.sellerConfirmDueAt} />. Otherwise the buyer is refunded automatically.
              </p>
            )}
            {!declining ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} onClick={() => act('confirm')}>
                  Confirm order
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setDeclining(true)}>
                  Decline and refund
                </Button>
              </div>
            ) : (
              <form
                className="max-w-lg space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act('decline', { reason });
                }}
              >
                <label htmlFor="decline-reason" className="text-sm font-medium">
                  Why can you not supply this order? The buyer sees this.
                </label>
                <Textarea id="decline-reason" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={500} />
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" type="submit" disabled={busy || reason.trim().length < 3}>
                    Decline and refund the buyer
                  </Button>
                  <Button size="sm" variant="ghost" type="button" onClick={() => setDeclining(false)}>
                    Back
                  </Button>
                </div>
              </form>
            )}
            <FormError message={error} />
          </div>
        )}
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
