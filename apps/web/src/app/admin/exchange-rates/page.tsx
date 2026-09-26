'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FormError } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, errorMessage } from '@/lib/api';

interface Rate { id: string; baseCurrency: string; quoteCurrency: string; rate: string; source: string; effectiveAt: string }

export default function ExchangeRatesPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['fx'], queryFn: () => api<{ items: Rate[] }>('/admin/exchange-rates') });
  const [form, setForm] = useState({ base: 'USD', quote: 'XCD', rate: '', source: '' });
  const [error, setError] = useState<string | null>(null);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/admin/exchange-rates', { method: 'POST', body: { ...form, base: form.base.toUpperCase(), quote: form.quote.toUpperCase() } });
      setForm((f) => ({ ...f, rate: '', source: '' }));
      await qc.invalidateQueries({ queryKey: ['fx'] });
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Each transaction stores the rate it used and is never recalculated. Rates cannot be edited or deleted; add a new rate to replace one. The pilot lane (St. Lucia → St. Vincent) uses EC dollars on
        both sides, so no conversion happens.
      </p>
      <form onSubmit={add} className="grid max-w-3xl gap-3 sm:grid-cols-[90px_90px_140px_1fr_auto] sm:items-end">
        {(['base', 'quote'] as const).map((k) => (
          <div key={k} className="space-y-1">
            <Label htmlFor={`fx-${k}`}>{k === 'base' ? 'From' : 'To'}</Label>
            <Input id={`fx-${k}`} value={form[k]} maxLength={3} required onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
          </div>
        ))}
        <div className="space-y-1">
          <Label htmlFor="fx-rate">Rate</Label>
          <Input id="fx-rate" inputMode="decimal" placeholder="2.70" value={form.rate} required onChange={(e) => setForm({ ...form, rate: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fx-source">Source</Label>
          <Input id="fx-source" placeholder="e.g. ECCB peg" value={form.source} required minLength={2} maxLength={60} onChange={(e) => setForm({ ...form, source: e.target.value })} />
        </div>
        <Button type="submit">Add rate</Button>
      </form>
      <FormError message={error} />
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pair</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Effective from</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">{r.baseCurrency} → {r.quoteCurrency}</TableCell>
                <TableCell>{r.rate}</TableCell>
                <TableCell>{r.source}</TableCell>
                <TableCell>{new Date(r.effectiveAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
