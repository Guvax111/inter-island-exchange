'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { FormError } from '@/components/forms/field';
import { formatHs } from '@/components/tariffs/tariff-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, apiForm, errorMessage } from '@/lib/api';

interface Import {
  id: string;
  name: string;
  source: string;
  fileName: string;
  effectiveFrom: string;
  status: 'DRAFT' | 'ACTIVE' | 'DISCARDED';
  summary: { rowsRead?: number; layout?: string; columns?: Record<string, string>; linesByCountry?: Record<string, number>; withoutRate?: Record<string, number>; skippedCount?: number; skipped?: { row: number; reason: string }[] };
  createdAt: string;
  schedules: { country: string; countryName: string; status: string; lines: number }[];
  sample: { hsCode: string; description: string; generalDutyPercent: number | null; caricomDutyPercent: number | null; vatPercent: number | null; rateText: string | null; restriction: string }[];
}

export default function AdminTariffsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['tariff-imports'], queryFn: () => api<{ items: Import[] }>('/admin/tariffs/imports').then((r) => r.items) });
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['tariff-imports'] });
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold">Import a tariff schedule</h2>
        <p className="text-sm text-muted-foreground">
          CSV or Excel (.xlsx) with a header row containing an <strong>HS code</strong> column and a <strong>description</strong> column, and either one rate column (e.g. “CET rate”) applied to the countries
          you choose, or one rate column per country (headed with the country’s name or code, e.g. “St. Vincent” or “SVG”). Optional columns: CARICOM rate, VAT, restriction (prohibited / licence), notes.
          Rates can be written as 20, 20% or Free. The import is a draft until you activate it.
        </p>
        <ImportForm onDone={() => qc.invalidateQueries({ queryKey: ['tariff-imports'] })} />
      </section>
      <FormError message={error} />
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Imports</h2>
        {data?.length === 0 && <p className="text-sm text-muted-foreground">No tariff schedules imported yet. Until one is active, duties at checkout use IIE’s estimate rules (Checkout settings).</p>}
        {data?.map((i) => (
          <div key={i.id} className="rounded-lg border p-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">
                  {i.name} <Badge variant={i.status === 'ACTIVE' ? 'default' : 'secondary'}>{i.status.toLowerCase()}</Badge>
                </p>
                <p className="text-muted-foreground">
                  {i.source} · {i.fileName} · in force from {new Date(i.effectiveFrom).toLocaleDateString()} · imported {new Date(i.createdAt).toLocaleString()}
                </p>
              </div>
              {i.status === 'DRAFT' && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => confirm(`Activate "${i.name}"? It replaces the current schedule for ${i.schedules.map((s) => s.country).join(', ')}.`) && run(() => api(`/admin/tariffs/imports/${i.id}/activate`, { method: 'POST' }))}>
                    Activate
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => run(() => api(`/admin/tariffs/imports/${i.id}/discard`, { method: 'POST' }))}>
                    Discard
                  </Button>
                </div>
              )}
            </div>
            <p className="mt-2">
              {i.summary.rowsRead} rows read · {i.summary.layout === 'ONE_RATE_COLUMN_PER_COUNTRY' ? 'one rate column per country' : 'single rate column'} ·{' '}
              {i.schedules.map((s) => `${s.countryName}: ${s.lines} lines (${s.status.toLowerCase()})`).join(' · ')}
              {!!i.summary.skippedCount && ` · ${i.summary.skippedCount} rows skipped`}
            </p>
            {i.summary.columns && <p className="text-xs text-muted-foreground">Columns used: {Object.entries(i.summary.columns).map(([k, v]) => `${k} = “${v}”`).join(', ')}</p>}
            {!!i.summary.skipped?.length && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs">Skipped rows</summary>
                <ul className="mt-1 text-xs text-muted-foreground">
                  {i.summary.skipped.map((s, n) => (
                    <li key={n}>
                      Row {s.row}: {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {i.sample.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs">First lines</summary>
                <ul className="mt-1 font-mono text-xs">
                  {i.sample.map((l) => (
                    <li key={l.hsCode}>
                      {formatHs(l.hsCode)} {l.description.slice(0, 80)} · {l.generalDutyPercent ?? l.rateText ?? '—'} / CARICOM {l.caricomDutyPercent ?? '—'} {l.restriction !== 'NONE' && `· ${l.restriction}`}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

function ImportForm({ onDone }: { onDone: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ name: 'CARICOM Common External Tariff', source: '', effectiveFrom: new Date().toISOString().slice(0, 10), countryCodes: 'VC,LC', caricomDefaultPercent: '0' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const chosen = file.current?.files?.[0];
    if (!chosen) return setError('Choose the file');
    const form = new FormData();
    for (const [k, v] of Object.entries(f)) form.append(k, v);
    form.append('file', chosen);
    setBusy(true);
    setError(null);
    try {
      await apiForm('/admin/tariffs/imports', form);
      if (file.current) file.current.value = '';
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const field = (k: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`ti-${k}`}>{label}</Label>
      <Input id={`ti-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />
    </div>
  );
  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
      {field('name', 'Schedule name', { required: true, minLength: 3 })}
      {field('source', 'Published by (source)', { required: true, placeholder: 'e.g. CARICOM Secretariat; SVG Customs and Excise' })}
      {field('effectiveFrom', 'In force from', { type: 'date', required: true })}
      {field('countryCodes', 'Countries (single-rate files only)', { placeholder: 'VC,LC' })}
      {field('caricomDefaultPercent', 'Duty on CARICOM-origin goods when the file has no CARICOM column (%)', { inputMode: 'decimal' })}
      <div className="space-y-1">
        <Label htmlFor="ti-file">File</Label>
        <input id="ti-file" ref={file} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="w-full text-sm" />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Reading the file…' : 'Import as draft'}
        </Button>
        <FormError message={error} />
      </div>
    </form>
  );
}
