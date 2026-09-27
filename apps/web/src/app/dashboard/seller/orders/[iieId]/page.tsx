'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FormError } from '@/components/forms/field';
import { HoursCountdown } from '@/components/orders/countdown';
import { CostBreakdown } from '@/components/orders/cost-breakdown';
import { ShipmentPanel } from '@/components/orders/shipment-panel';
import { TariffLine } from '@/components/orders/tariff-line';
import { DisputePanel } from '@/components/disputes/dispute-panel';
import { OrderTimeline } from '@/components/orders/order-timeline';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import type { OrderDetail } from '@/lib/types';

export default function SellerOrderPage() {
  const { iieId } = useParams<{ iieId: string }>();
  const qc = useQueryClient();
  const { data: order, isLoading } = useQuery({ queryKey: ['sale', iieId], queryFn: () => api<OrderDetail>(`/me/sales/${iieId}`) });
  const [declining, setDeclining] = useState(false);
  const [parcelKg, setParcelKg] = useState('');
  const [pickupNotes, setPickupNotes] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(path: 'confirm' | 'decline' | 'ready', body: object = {}) {
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
    SELLER_CONFIRMED: 'You confirmed this order. Pack it, then mark it ready for pickup so the logistics partner can collect it.',
    PREPARING_SHIPMENT: 'Packed and waiting for the logistics partner to schedule the pickup.',
    PICKUP_SCHEDULED: 'The logistics partner will collect the parcel at the time shown below. Have it ready.',
    PICKED_UP: 'Collected. Nothing more to do; you can follow the shipment below.',
    EXPORT_PROCESSING: 'On its way. Nothing more to do.',
    IN_TRANSIT: 'On its way. Nothing more to do.',
    ARRIVED_DESTINATION: 'Arrived in the destination country. Nothing more to do.',
    CUSTOMS_PROCESSING: 'At customs. IIE may contact you if customs asks for documents.',
    CUSTOMS_HOLD: 'Held by customs. IIE may contact you for documents.',
    CUSTOMS_CLEARED: 'Cleared customs; delivery is next.',
    OUT_FOR_DELIVERY: 'Out for delivery.',
    DELIVERED: 'Delivered. The buyer has 3 days to confirm or report a problem; you are paid 7 days after delivery is confirmed.',
    DELIVERY_CONFIRMED: 'Delivery confirmed. You are paid in 7 days if the buyer reports no problem.',
    DISPUTE_WINDOW: 'Delivery confirmed. You are paid when the 7-day review period ends, if the buyer reports no problem.',
    DISPUTED: 'The buyer reported a problem. Reply below with your side and any photos; IIE decides. Your payout is on hold until then.',
    PARTIALLY_REFUNDED: 'IIE decided on the buyer’s report: part of the payment was refunded and your payout reduced.',
    PAYOUT_APPROVED: 'Your payout has been approved.',
    PAYOUT_PROCESSING: 'Your payout is being sent by the payment provider.',
    COMPLETED: 'Complete: you have been paid.',
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
        <p className="mt-1 text-sm">
          Questions about this order go through IIE:{' '}
          <Link href={`/messages/new?order=${order.iieId}`} className="underline">
            message IIE
          </Link>
        </p>
      </div>
      <div className="rounded-lg border-l-4 border-ocean-600 bg-ocean-50 p-4" role="status">
        <p className="font-semibold">{order.statusLabel}</p>
        <p className="text-sm">{next[order.status] ?? 'IIE will tell you what to do next.'}</p>
        {order.canMarkReady && (
          <form
            className="mt-3 grid max-w-2xl gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              const grams = parcelKg ? Math.round(Number(parcelKg) * 1000) : undefined;
              void act('ready', { ...(grams ? { parcelWeightGrams: grams } : {}), ...(pickupNotes ? { pickupNotes } : {}) });
            }}
          >
            <div className="space-y-1">
              <label htmlFor="parcel-kg" className="text-sm font-medium">
                Packed weight (kg)
              </label>
              <Input id="parcel-kg" inputMode="decimal" placeholder="optional" value={parcelKg} onChange={(e) => setParcelKg(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label htmlFor="pickup-notes" className="text-sm font-medium">
                Notes for the driver
              </label>
              <Input id="pickup-notes" placeholder="e.g. side gate, open 8am–4pm" maxLength={500} value={pickupNotes} onChange={(e) => setPickupNotes(e.target.value)} />
            </div>
            <Button type="submit" disabled={busy}>
              Ready for pickup
            </Button>
            <FormError message={error} />
          </form>
        )}
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
                      <TariffLine tariff={i.tariff} />
                    </span>
                    <span>{i.lineTotal.formatted}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          {order.dispute && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Problem reported by the buyer</CardTitle>
              </CardHeader>
              <CardContent>
                <DisputePanel iieId={order.iieId} />
              </CardContent>
            </Card>
          )}
          {order.shipment && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Shipment</CardTitle>
              </CardHeader>
              <CardContent>
                <ShipmentPanel shipment={order.shipment} showWeights />
              </CardContent>
            </Card>
          )}
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
            {order.payout && (
              <p className="mt-3 text-sm">
                Payout: <strong>{order.payout.amount.formatted}</strong> · {order.payout.status === 'ON_HOLD' ? 'held until the review period ends' : order.payout.status.toLowerCase().replace('_', ' ')}
                {order.payout.paidAt && ` on ${new Date(order.payout.paidAt).toLocaleDateString()}`}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
