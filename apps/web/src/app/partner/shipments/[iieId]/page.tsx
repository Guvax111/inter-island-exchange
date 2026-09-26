'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { FormError } from '@/components/forms/field';
import { ShipmentPanel } from '@/components/orders/shipment-panel';
import { SignaturePad, type SignaturePadHandle } from '@/components/partner/signature-pad';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, apiForm, errorMessage } from '@/lib/api';
import type { PartnerShipmentDetail, ShipmentStep } from '@/lib/types';

const STEP_BUTTONS: Record<ShipmentStep, string> = {
  SCHEDULE_PICKUP: 'Schedule pickup',
  PICKED_UP: 'Picked up',
  EXPORT_PROCESSING: 'Export processing',
  IN_TRANSIT: 'In transit',
  ARRIVED_DESTINATION: 'Arrived in destination',
  CUSTOMS_PROCESSING: 'Customs processing started',
  CUSTOMS_CLEARED: 'Cleared customs',
  CUSTOMS_HOLD: 'Held by customs',
  CUSTOMS_RELEASED: 'Released by customs',
  OUT_FOR_DELIVERY: 'Out for delivery',
};

/** Local time for a datetime-local input. */
const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

const address = (a: Record<string, string | null>) => [a.line1, a.line2, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(', ');

export default function PartnerShipmentPage() {
  const { iieId } = useParams<{ iieId: string }>();
  const qc = useQueryClient();
  const { data: s, isLoading } = useQuery({ queryKey: ['partner-shipment', iieId], queryFn: () => api<PartnerShipmentDetail>(`/partner/shipments/${iieId}`) });
  const update = (d: PartnerShipmentDetail) => {
    qc.setQueryData(['partner-shipment', iieId], d);
    void qc.invalidateQueries({ queryKey: ['partner-shipments'] });
  };
  if (isLoading) return <p className="container py-8 text-muted-foreground">Loading…</p>;
  if (!s) return <p className="container py-8 text-muted-foreground">Shipment not found.</p>;

  return (
    <section className="container max-w-5xl space-y-6 py-8">
      <div>
        <Link href="/partner" className="text-sm underline">
          All shipments
        </Link>
        <h1 className="mt-1 font-mono text-2xl font-bold text-ocean-900">{s.iieId}</h1>
        <p className="text-muted-foreground">
          {s.statusLabel} · you handle {s.yourRoles.map((r) => (r === 'LOGISTICS' ? 'transport and delivery' : 'customs')).join(' and ')}
        </p>
      </div>

      {(s.nextSteps.length > 0 || s.canDeliver) && (
        <Card className="border-ocean-600">
          <CardHeader>
            <CardTitle className="text-lg">Next step</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {s.nextSteps.map((step) => (
              <StepForm key={step} iieId={s.iieId} step={step} onDone={update} />
            ))}
            {s.canDeliver && <DeliveryForm iieId={s.iieId} onDone={update} />}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pickup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-medium">{s.pickup.contact.name}</p>
            <p>{address(s.pickup.address)}</p>
            {s.pickup.contact.phone && (
              <p>
                <a className="underline" href={`tel:${s.pickup.contact.phone}`}>
                  {s.pickup.contact.phone}
                </a>
              </p>
            )}
            {s.pickup.notes && <p className="rounded bg-muted p-2">{s.pickup.notes}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Delivery</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-medium">{s.delivery.contact.name}</p>
            <p>{address(s.delivery.address)}</p>
            {s.delivery.contact.phone && (
              <p>
                <a className="underline" href={`tel:${s.delivery.contact.phone}`}>
                  {s.delivery.contact.phone}
                </a>
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Contents</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <ul className="divide-y">
              {s.items.map((i) => (
                <li key={i.sku} className="flex justify-between gap-3 py-1">
                  <span>
                    {i.quantity} × {i.title} ({i.variantName})
                  </span>
                  <span className="text-muted-foreground">{((i.unitWeightGrams * i.quantity) / 1000).toFixed(2)} kg</span>
                </li>
              ))}
            </ul>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link href={`/partner/shipments/${s.iieId}/invoice`}>Commercial invoice and packing list</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Tracking</CardTitle>
          </CardHeader>
          <CardContent>
            <ShipmentPanel shipment={s.shipment} showWeights />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function StepForm({ iieId, step, onDone }: { iieId: string; step: ShipmentStep; onDone: (d: PartnerShipmentDetail) => void }) {
  const [v, setV] = useState<Record<string, string>>(step === 'SCHEDULE_PICKUP' ? { pickupAt: localNow() } : {});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const field = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`${step}-${k}`}>{label}</Label>
      <Input id={`${step}-${k}`} value={v[k] ?? ''} onChange={set(k)} {...props} />
    </div>
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { step };
    for (const [k, val] of Object.entries(v)) if (val.trim()) body[k] = val.trim();
    if (v.pickupAt) body.pickupAt = new Date(v.pickupAt).toISOString();
    if (v.actualKg) {
      body.actualWeightGrams = Math.round(Number(v.actualKg) * 1000);
      delete body.actualKg;
    }
    try {
      onDone(await api<PartnerShipmentDetail>(`/partner/shipments/${iieId}/steps`, { method: 'POST', body }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {step === 'SCHEDULE_PICKUP' && field('pickupAt', 'Pickup date and time', { type: 'datetime-local', required: true })}
        {step === 'PICKED_UP' && field('actualKg', 'Weight measured at pickup (kg)', { inputMode: 'decimal', required: true })}
        {(step === 'PICKED_UP' || step === 'SCHEDULE_PICKUP') && field('trackingReference', 'Your reference (waybill, optional)', { maxLength: 60 })}
        {step === 'CUSTOMS_CLEARED' && field('customsEntryNumber', 'Customs entry number (optional)', { maxLength: 60 })}
        {step === 'CUSTOMS_CLEARED' && field('dutiesAssessed', 'Duties and taxes assessed, paid by the buyer on arrival (optional)', { inputMode: 'decimal', placeholder: 'e.g. 21.60' })}
        {step === 'CUSTOMS_HOLD' && field('reason', 'Why is customs holding it?', { required: true, minLength: 3, maxLength: 500 })}
        {!['CUSTOMS_HOLD'].includes(step) && field('location', 'Location (optional)', { maxLength: 120 })}
        {step !== 'CUSTOMS_HOLD' && field('note', 'Note (optional)', { maxLength: 500 })}
      </div>
      <Button type="submit" disabled={busy} variant={step === 'CUSTOMS_HOLD' ? 'outline' : 'default'}>
        {STEP_BUTTONS[step]}
      </Button>
      <FormError message={error} />
    </form>
  );
}

function DeliveryForm({ iieId, onDone }: { iieId: string; onDone: (d: PartnerShipmentDetail) => void }) {
  const [recipientName, setRecipientName] = useState('');
  const [deliveredAt, setDeliveredAt] = useState(localNow);
  const [note, setNote] = useState('');
  const photo = useRef<HTMLInputElement>(null);
  const signature = useRef<SignaturePadHandle>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('recipientName', recipientName);
    form.append('deliveredAt', new Date(deliveredAt).toISOString());
    if (note.trim()) form.append('note', note.trim());
    const file = photo.current?.files?.[0];
    if (file) form.append('photo', file);
    const sig = await signature.current?.toBlob();
    if (sig) form.append('signature', sig, 'signature.png');
    try {
      onDone(await apiForm<PartnerShipmentDetail>(`/partner/shipments/${iieId}/delivery`, form));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border p-4">
      <p className="font-semibold">Proof of delivery</p>
      <p className="text-sm text-muted-foreground">Recipient name and time are required. Add a photo of the parcel at the door and/or the recipient’s signature where you can.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="recipient">Received by</Label>
          <Input id="recipient" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} required minLength={2} maxLength={120} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="delivered-at">Delivered at</Label>
          <Input id="delivered-at" type="datetime-local" value={deliveredAt} onChange={(e) => setDeliveredAt(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pod-photo">Photo (optional)</Label>
          <Input id="pod-photo" ref={photo} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pod-note">Note (optional)</Label>
          <Input id="pod-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </div>
      </div>
      <SignaturePad ref={signature} label="Recipient’s signature (optional)" />
      <Button type="submit" disabled={busy || recipientName.trim().length < 2}>
        {busy ? 'Saving…' : 'Delivered'}
      </Button>
      <FormError message={error} />
    </form>
  );
}
