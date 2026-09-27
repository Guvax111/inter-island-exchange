'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { FormError } from '@/components/forms/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, errorMessage } from '@/lib/api';
import type { Money } from '@/lib/types';

interface Settlement {
  id: string;
  kind: 'PROVIDER_REMITTANCE' | 'LOGISTICS_PAYMENT';
  iieId: string;
  counterparty: string;
  direction: 'RECEIVABLE' | 'PAYABLE';
  amount: Money;
  dueAt: string;
  overdue: boolean;
  status: 'DUE' | 'PAID';
  paidAt: string | null;
  reference: string | null;
}

const FILTERS = [
  { key: 'due', label: 'Due', query: 'status=DUE' },
  { key: 'overdue', label: 'Overdue', query: 'overdue=true' },
  { key: 'receivable', label: 'Owed to IIE', query: 'status=DUE&kind=PROVIDER_REMITTANCE' },
  { key: 'payable', label: 'Owed by IIE', query: 'status=DUE&kind=LOGISTICS_PAYMENT' },
  { key: 'paid', label: 'Settled', query: 'status=PAID' },
];

export default function AdminSettlementsPage() {
  const [filter, setFilter] = useState(FILTERS[0]!);
  const [recording, setRecording] = useState<Settlement | null>(null);
  const { data } = useQuery({ queryKey: ['settlements', filter.key], queryFn: () => api<{ items: Settlement[] }>(`/admin/settlements?${filter.query}`).then((r) => r.items) });
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        The payment provider pays IIE its share of each order (fee, shipping and anything kept back from a seller) <strong>30 days after the seller is paid</strong>. IIE pays the logistics partner the
        shipping <strong>45 days after delivery</strong>. Record each payment when it is made, with the bank or provider reference; it is posted to the ledger.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1 text-sm ${filter.key === f.key ? 'bg-ocean-900 text-white' : ''}`}>
            {f.label}
          </button>
        ))}
      </div>
      {recording && <RecordPayment s={recording} onDone={() => setRecording(null)} />}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Transaction</TableHead>
              <TableHead>What</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-mono text-sm">{s.iieId}</TableCell>
                <TableCell className="text-sm">{s.direction === 'RECEIVABLE' ? `${s.counterparty} pays IIE` : `IIE pays ${s.counterparty}`}</TableCell>
                <TableCell className="text-sm">
                  {s.status === 'PAID' ? (
                    <>Paid {new Date(s.paidAt!).toLocaleDateString()} · {s.reference}</>
                  ) : (
                    <>
                      {new Date(s.dueAt).toLocaleDateString()} {s.overdue && <Badge variant="destructive">Overdue</Badge>}
                    </>
                  )}
                </TableCell>
                <TableCell className="text-right">{s.amount.formatted}</TableCell>
                <TableCell className="text-right">
                  {s.status === 'DUE' && (
                    <Button size="sm" variant="outline" onClick={() => setRecording(s)}>
                      {s.direction === 'RECEIVABLE' ? 'Record receipt' : 'Record payment'}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Nothing here.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function RecordPayment({ s, onDone }: { s: Settlement; onDone: () => void }) {
  const qc = useQueryClient();
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/admin/settlements/${s.id}/paid`, { method: 'POST', body: { reference, paidOn } });
      await qc.invalidateQueries({ queryKey: ['settlements'] });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-[1fr_180px_auto_auto] sm:items-end">
      <p className="sm:col-span-4">
        {s.direction === 'RECEIVABLE' ? 'Received from' : 'Paid to'} {s.counterparty}: <strong>{s.amount.formatted}</strong> for <span className="font-mono">{s.iieId}</span>
      </p>
      <div className="space-y-1">
        <Label htmlFor="settle-ref">Bank or provider reference</Label>
        <Input id="settle-ref" value={reference} onChange={(e) => setReference(e.target.value)} required minLength={2} maxLength={120} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="settle-date">Date</Label>
        <Input id="settle-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} required />
      </div>
      <Button type="submit">Record</Button>
      <Button type="button" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
      <div className="sm:col-span-4">
        <FormError message={error} />
      </div>
    </form>
  );
}
