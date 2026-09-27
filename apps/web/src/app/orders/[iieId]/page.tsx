'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, useState, type ReactNode } from 'react';
import { RequireSignIn } from '@/components/account/require-signin';
import { FormError } from '@/components/forms/field';
import { CostBreakdown } from '@/components/orders/cost-breakdown';
import { OrderTimeline } from '@/components/orders/order-timeline';
import { HoursCountdown } from '@/components/orders/countdown';
import { PaymentCountdown } from '@/components/orders/payment-countdown';
import { ShipmentPanel } from '@/components/orders/shipment-panel';
import { DisputePanel } from '@/components/disputes/dispute-panel';
import { ReviewPanel } from '@/components/reviews/review-panel';
import { TariffLine } from '@/components/orders/tariff-line';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import type { OrderDetail } from '@/lib/types';

export default function OrderPage() {
  return (
    <section className="container max-w-5xl py-8">
      <RequireSignIn>
        {() => (
          <Suspense>
            <Order />
          </Suspense>
        )}
      </RequireSignIn>
    </section>
  );
}

function Order() {
  const { iieId } = useParams<{ iieId: string }>();
  const qc = useQueryClient();
  // Set when the buyer comes back from the payment page (?payment=succeed|decline|processing|cancel).
  const returned = useSearchParams().get('payment');
  const { data: order, isLoading, error: loadError } = useQuery({
    queryKey: ['order', iieId],
    queryFn: () => api<OrderDetail>(`/me/orders/${iieId}`),
    // The provider confirms by webhook, which can arrive after the redirect: keep checking until it lands.
    refetchInterval: (q) => (returned && ['AWAITING_PAYMENT', 'PAYMENT_PROCESSING'].includes(q.state.data?.status ?? '') ? 3000 : false),
  });
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (loadError || !order) return <p className="text-muted-foreground">Order not found. <Link href="/orders" className="underline">My orders</Link></p>;

  async function pay() {
    setError(null);
    setPaying(true);
    try {
      const { redirectUrl } = await api<{ redirectUrl: string }>(`/me/orders/${iieId}/pay`, { method: 'POST', body: {} });
      window.location.assign(redirectUrl);
    } catch (err) {
      setPaying(false);
      setError(errorMessage(err));
    }
  }

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
        <p className="mt-1 text-sm">
          <Link href={`/messages/new?order=${order.iieId}`} className="underline">
            Message IIE about this order
          </Link>
        </p>
      </div>

      <PaymentPanel order={order} returned={returned} paying={paying} onPay={pay} onCancel={cancel} error={error} />
      <DeliveryPanel order={order} onChange={(o) => qc.setQueryData(['order', iieId], o)} />

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
          {(order.canReview || order.review) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{order.review ? 'Your review' : 'Rate this order'}</CardTitle>
              </CardHeader>
              <CardContent>
                <ReviewPanel order={order} onSaved={() => qc.invalidateQueries({ queryKey: ['order', iieId] })} />
              </CardContent>
            </Card>
          )}
          {order.dispute && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Reported problem</CardTitle>
              </CardHeader>
              <CardContent>
                <DisputePanel iieId={order.iieId} />
              </CardContent>
            </Card>
          )}
          {order.shipment && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Shipment tracking</CardTitle>
              </CardHeader>
              <CardContent>
                <ShipmentPanel shipment={order.shipment} />
              </CardContent>
            </Card>
          )}
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
                      <TariffLine tariff={i.tariff} />
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

function Notice({ tone, title, children }: { tone: 'wait' | 'good' | 'bad' | 'info'; title: ReactNode; children?: ReactNode }) {
  const styles = {
    wait: 'border-coral-400 bg-orange-50',
    good: 'border-palm-600 bg-green-50',
    bad: 'border-red-500 bg-red-50',
    info: 'border-ocean-600 bg-ocean-50',
  }[tone];
  return (
    <div className={`rounded-lg border-l-4 p-4 ${styles}`} role="status">
      <p className="font-semibold">{title}</p>
      {children}
    </div>
  );
}

/** What the buyer needs to know or do right now about paying for this order. */
function PaymentPanel({ order, returned, paying, onPay, onCancel, error }: { order: OrderDetail; returned: string | null; paying: boolean; onPay: () => void; onCancel: () => void; error: string | null }) {
  const actions = (label: string) => (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        {order.canPay && (
          <Button size="sm" onClick={onPay} disabled={paying}>
            {paying ? 'Opening payment page…' : label}
          </Button>
        )}
        {order.canCancel && (
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel order
          </Button>
        )}
      </div>
      <FormError message={error} />
    </>
  );
  switch (order.status) {
    case 'AWAITING_PAYMENT':
      if (returned === 'succeed') {
        return <Notice tone="info" title="Confirming your payment…">
          <p className="mt-1 text-sm">The payment provider is confirming your payment. This page updates by itself.</p>
        </Notice>;
      }
      return (
        <Notice tone="wait" title={<>Waiting for payment · items reserved{order.paymentDueAt && <>, <PaymentCountdown dueAt={order.paymentDueAt} /></>}</>}>
          <p className="mt-1 text-sm">
            You pay on the secure page of IIE&apos;s payment provider. The provider holds your money until the order is complete; IIE never sees your card details. If the order is not paid in time it is cancelled
            automatically and you are not charged.
          </p>
          {returned === 'cancel' && <p className="mt-1 text-sm font-medium">You left the payment page without paying.</p>}
          {actions(`Pay ${order.amounts.total.formatted}`)}
        </Notice>
      );
    case 'PAYMENT_FAILED':
      return (
        <Notice tone="bad" title={<>Payment did not go through{order.paymentDueAt && <> · items still reserved, <PaymentCountdown dueAt={order.paymentDueAt} /></>}</>}>
          <p className="mt-1 text-sm">You were not charged. You can try again, with the same or another payment method.</p>
          {actions('Try again')}
        </Notice>
      );
    case 'PAYMENT_PROCESSING':
      return (
        <Notice tone="info" title="Payment is being processed">
          <p className="mt-1 text-sm">Your bank or payment method is still processing the payment. Your items stay reserved, and we will email you as soon as it is confirmed.</p>
        </Notice>
      );
    case 'PAYMENT_CONFIRMED':
    case 'AWAITING_SELLER_CONFIRMATION':
      return (
        <Notice tone="good" title="Paid · waiting for the seller to confirm">
          <p className="mt-1 text-sm">
            Your payment is held by the payment provider, not paid to the seller yet. The seller has 48 hours to confirm they can supply your order
            {order.sellerConfirmDueAt && <> (<HoursCountdown dueAt={order.sellerConfirmDueAt} />)</>}. If they do not, you are refunded in full automatically.
          </p>
        </Notice>
      );
    case 'SELLER_CONFIRMED':
      return (
        <Notice tone="good" title="The seller confirmed your order">
          <p className="mt-1 text-sm">The seller is getting your order ready for shipping. Your payment stays held until the order is complete.</p>
        </Notice>
      );
    case 'REFUNDED':
      return (
        <Notice tone="info" title="Refunded in full">
          <p className="mt-1 text-sm">{order.timeline.at(-1)?.reason ?? 'This order was refunded.'} Refunds usually reach your account within 5–10 business days, depending on your bank.</p>
        </Notice>
      );
    case 'COMPLIANCE_HOLD':
      return (
        <Notice tone="wait" title="Under review by IIE">
          <p className="mt-1 text-sm">IIE is checking something about this payment before the order continues. We will email you; you do not need to do anything now.</p>
        </Notice>
      );
    case 'CANCELLED':
      return (
        <Notice tone="info" title="Cancelled">
          <p className="mt-1 text-sm">{order.timeline.at(-1)?.reason ?? 'This order was cancelled.'} You were not charged.</p>
        </Notice>
      );
    default:
      return null;
  }
}

/** After delivery: confirm receipt or report a problem within the confirmation period. */
function DeliveryPanel({ order, onChange }: { order: OrderDetail; onChange: (o: OrderDetail) => void }) {
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(path: 'confirm-delivery' | 'report-problem', body: object = {}) {
    setBusy(true);
    setError(null);
    try {
      await api(`/me/orders/${order.iieId}/${path}`, { method: 'POST', body });
      onChange(await api<OrderDetail>(`/me/orders/${order.iieId}`));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const reportForm = (
    <form
      className="mt-3 max-w-lg space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void act('report-problem', { reason });
      }}
    >
      <label htmlFor="problem" className="text-sm font-medium">
        What went wrong? (missing or damaged items, wrong product…)
      </label>
      <Textarea id="problem" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={10} maxLength={1000} />
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={busy || reason.trim().length < 10}>
          Send report
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setReporting(false)}>
          Back
        </Button>
      </div>
    </form>
  );
  switch (order.status) {
    case 'PREPARING_SHIPMENT':
    case 'PICKUP_SCHEDULED':
    case 'PICKED_UP':
    case 'EXPORT_PROCESSING':
    case 'IN_TRANSIT':
    case 'ARRIVED_DESTINATION':
    case 'CUSTOMS_PROCESSING':
    case 'CUSTOMS_CLEARED':
    case 'OUT_FOR_DELIVERY':
      return (
        <Notice tone="info" title={order.statusLabel}>
          <p className="mt-1 text-sm">
            Your order is on its way. Duties and taxes are paid on arrival
            {order.shipment?.customs.dutiesAssessed ? `: customs assessed ${order.shipment.customs.dutiesAssessed.formatted}` : ` (estimated ${order.amounts.dutiesEstimate.formatted})`}.
          </p>
        </Notice>
      );
    case 'CUSTOMS_HOLD':
      return (
        <Notice tone="wait" title="Held by customs">
          <p className="mt-1 text-sm">{order.timeline.at(-1)?.reason ?? 'Customs is holding your parcel.'} The customs broker is dealing with it; you do not need to do anything unless we contact you.</p>
        </Notice>
      );
    case 'DELIVERED':
      return (
        <Notice tone="good" title="Delivered: did everything arrive as expected?">
          <p className="mt-1 text-sm">
            Please confirm, or tell us about a problem
            {order.deliveryConfirmDueAt && <> (<HoursCountdown dueAt={order.deliveryConfirmDueAt} />)</>}. If we do not hear from you by then, the delivery is confirmed automatically.
          </p>
          {!reporting ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => act('confirm-delivery')}>
                Yes, I received my order
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setReporting(true)}>
                Report a problem
              </Button>
            </div>
          ) : (
            reportForm
          )}
          <FormError message={error} />
        </Notice>
      );
    case 'DISPUTE_WINDOW':
      return (
        <Notice tone="good" title="Delivery confirmed">
          <p className="mt-1 text-sm">
            If something is wrong with your order you can still report it
            {order.reviewEndsAt && <> (<HoursCountdown dueAt={order.reviewEndsAt} />)</>}. After that the seller is paid.
          </p>
          {!reporting ? (
            <Button size="sm" variant="outline" className="mt-3" onClick={() => setReporting(true)}>
              Report a problem
            </Button>
          ) : (
            reportForm
          )}
          <FormError message={error} />
        </Notice>
      );
    case 'DELIVERY_CONFIRMED':
      return (
        <Notice tone="good" title="Delivery confirmed">
          <p className="mt-1 text-sm">Thank you for shopping with IIE.</p>
        </Notice>
      );
    case 'DISPUTED':
      return (
        <Notice tone="wait" title="Problem reported">
          <p className="mt-1 text-sm">IIE is looking into your report. Add details or photos below; your payment stays held by the payment provider until IIE decides.</p>
        </Notice>
      );
    case 'PARTIALLY_REFUNDED':
    case 'PAYOUT_APPROVED':
    case 'PAYOUT_PROCESSING':
    case 'COMPLETED':
      return order.dispute?.decision === 'PARTIAL_REFUND' ? (
        <Notice tone="info" title={`Partly refunded: ${order.dispute.refundAmount?.formatted ?? ''}`}>
          <p className="mt-1 text-sm">IIE decided on your report; see the decision below. Refunds usually reach your account within 5–10 business days, depending on your bank.</p>
        </Notice>
      ) : (
        <Notice tone="good" title="Complete">
          <p className="mt-1 text-sm">Thank you for shopping with IIE.</p>
        </Notice>
      );
    default:
      return null;
  }
}
