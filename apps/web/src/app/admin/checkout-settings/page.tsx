'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FormError } from '@/components/forms/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, errorMessage } from '@/lib/api';
import type { Money } from '@/lib/types';

interface Rate { id: string; origin: string; destination: string; serviceName: string; maxWeightGrams: number; price: Money; isPlaceholder: boolean; active: boolean }
interface Duty { id: string; destination: string; hsPrefix: string; caricomOriginDutyPercent: number; otherOriginDutyPercent: number; vatPercent: number; notes: string; isPlaceholder: boolean }

export default function CheckoutSettingsPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const fee = useQuery({ queryKey: ['fee-rule'], queryFn: () => api<{ percent: number; defaultPayer: 'BUYER' | 'SELLER' }>('/admin/fee-rule') });
  const rates = useQuery({ queryKey: ['rates'], queryFn: () => api<{ items: Rate[] }>('/admin/shipping-rates').then((r) => r.items) });
  const duties = useQuery({ queryKey: ['duties'], queryFn: () => api<{ items: Duty[] }>('/admin/duty-estimates').then((r) => r.items) });
  async function run(fn: () => Promise<unknown>, keys: string[]) {
    setError(null);
    try {
      await fn();
      for (const k of keys) await qc.invalidateQueries({ queryKey: [k] });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">Changes apply to new checkouts immediately. Orders already placed keep the amounts they were placed with. Every change is audited.</p>
      <FormError message={error} />

      <section>
        <h2 className="text-lg font-semibold">IIE platform fee</h2>
        {fee.data && <FeeEditor percent={fee.data.percent} payer={fee.data.defaultPayer} onSave={(body) => run(() => api('/admin/fee-rule', { method: 'PUT', body }), ['fee-rule'])} />}
        <p className="mt-1 text-xs text-muted-foreground">Sellers can choose to pay the fee themselves from their store profile.</p>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Shipping rates</h2>
        <div className="mt-2 overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lane</TableHead>
                <TableHead>Up to</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.data?.map((r) => (
                <RateRow key={r.id} rate={r} onSave={(body) => run(() => api(`/admin/shipping-rates/${r.id}`, { method: 'PATCH', body }), ['rates'])} />
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Duty and tax estimates</h2>
        <div className="mt-2 overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Destination / HS</TableHead>
                <TableHead>Duty (CARICOM origin)</TableHead>
                <TableHead>Duty (other origin)</TableHead>
                <TableHead>VAT</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {duties.data?.map((d) => (
                <DutyRow key={d.id} duty={d} onSave={(body) => run(() => api(`/admin/duty-estimates/${d.id}`, { method: 'PATCH', body }), ['duties'])} />
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function FeeEditor({ percent, payer, onSave }: { percent: number; payer: 'BUYER' | 'SELLER'; onSave: (b: object) => void }) {
  const [p, setP] = useState(String(percent));
  const [who, setWho] = useState(payer);
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <label className="text-sm">
        Percent of product cost
        <Input className="mt-1 w-28" inputMode="decimal" value={p} onChange={(e) => setP(e.target.value)} />
      </label>
      <label className="text-sm">
        Paid by default by
        <select className="mt-1 block h-10 rounded-md border px-3" value={who} onChange={(e) => setWho(e.target.value as 'BUYER' | 'SELLER')}>
          <option value="BUYER">Buyer (added to total)</option>
          <option value="SELLER">Seller (deducted from payout)</option>
        </select>
      </label>
      <Button size="sm" onClick={() => onSave({ percent: p, defaultPayer: who })}>Save fee</Button>
    </div>
  );
}

function RateRow({ rate, onSave }: { rate: Rate; onSave: (b: object) => void }) {
  const [price, setPrice] = useState((Number(rate.price.amountMinor) / 100).toFixed(2));
  return (
    <TableRow>
      <TableCell>{rate.origin} → {rate.destination}<p className="text-xs text-muted-foreground">{rate.serviceName}</p></TableCell>
      <TableCell>{rate.maxWeightGrams / 1000} kg</TableCell>
      <TableCell>
        <Input className="w-28" inputMode="decimal" aria-label={`Price up to ${rate.maxWeightGrams / 1000} kg`} value={price} onChange={(e) => setPrice(e.target.value)} />
      </TableCell>
      <TableCell>{rate.isPlaceholder ? <Badge variant="destructive">Placeholder</Badge> : <Badge>Confirmed</Badge>}</TableCell>
      <TableCell className="space-x-1 whitespace-nowrap text-right">
        <Button size="sm" variant="outline" onClick={() => onSave({ price })}>Save</Button>
        {rate.isPlaceholder && <Button size="sm" variant="ghost" onClick={() => onSave({ price, isPlaceholder: false })}>Save as confirmed</Button>}
      </TableCell>
    </TableRow>
  );
}

function DutyRow({ duty, onSave }: { duty: Duty; onSave: (b: object) => void }) {
  const [v, setV] = useState({ caricomOriginDutyPercent: String(duty.caricomOriginDutyPercent), otherOriginDutyPercent: String(duty.otherOriginDutyPercent), vatPercent: String(duty.vatPercent) });
  const field = (k: keyof typeof v, label: string) => <Input className="w-20" inputMode="decimal" aria-label={label} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />;
  return (
    <TableRow>
      <TableCell>
        {duty.destination} {duty.hsPrefix ? `HS ${duty.hsPrefix}…` : '(all products)'} {duty.isPlaceholder && <Badge variant="destructive">Placeholder</Badge>}
        <p className="max-w-xs text-xs text-muted-foreground">{duty.notes}</p>
      </TableCell>
      <TableCell>{field('caricomOriginDutyPercent', 'Duty for CARICOM origin %')}</TableCell>
      <TableCell>{field('otherOriginDutyPercent', 'Duty for other origin %')}</TableCell>
      <TableCell>{field('vatPercent', 'VAT %')}</TableCell>
      <TableCell className="space-x-1 whitespace-nowrap text-right">
        <Button size="sm" variant="outline" onClick={() => onSave(v)}>Save</Button>
        {duty.isPlaceholder && <Button size="sm" variant="ghost" onClick={() => onSave({ ...v, isPlaceholder: false })}>Save as confirmed</Button>}
      </TableCell>
    </TableRow>
  );
}
