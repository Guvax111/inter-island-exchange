'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { CostBreakdown } from '@/components/orders/cost-breakdown';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import type { OrderDetail, OrderSummary } from '@/lib/types';

export default function AdminTransactionsPage() {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['admin-tx', q], queryFn: () => api<{ items: OrderSummary[]; total: number }>(`/admin/transactions?pageSize=100${q ? `&q=${encodeURIComponent(q)}` : ''}`) });
  const detail = useQuery({ queryKey: ['admin-tx-detail', selected], enabled: !!selected, queryFn: () => api<OrderDetail & { version: number }>(`/admin/transactions/${selected}`) });
  const d = detail.data;
  return (
    <div className="space-y-4">
      <Input placeholder="Search by IIE ID, e.g. 000012" aria-label="Search transactions" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transaction</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data?.items.map((t) => (
                <TableRow key={t.iieId} className={`cursor-pointer ${selected === t.iieId ? 'bg-muted' : ''}`} onClick={() => setSelected(t.iieId)}>
                  <TableCell>
                    <button className="font-mono text-sm font-semibold underline-offset-2 hover:underline">{t.iieId}</button>
                    <p className="text-xs text-muted-foreground">{t.seller.name} → {t.buyerFirstName}</p>
                  </TableCell>
                  <TableCell className="text-sm">{t.statusLabel}</TableCell>
                  <TableCell className="text-right">{t.total.formatted}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {d && (
          <div className="space-y-4 text-sm">
            <h2 className="font-mono text-lg font-semibold">{d.iieId}</h2>
            <dl className="grid grid-cols-[140px_1fr] gap-1">
              <dt className="text-muted-foreground">Status</dt>
              <dd>{d.statusLabel} (v{d.version})</dd>
              {Object.entries(d.subStatuses).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="capitalize text-muted-foreground">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
              <dt className="text-muted-foreground">Buyer</dt>
              <dd>{d.buyer.firstName} {d.buyer.lastName} ({d.buyer.email})</dd>
              <dt className="text-muted-foreground">Currency</dt>
              <dd>{d.currency.transaction}, rate {d.currency.fxRate} ({d.currency.fxSource})</dd>
            </dl>
            <CostBreakdown {...d.amounts} />
            <h3 className="font-semibold">Event log</h3>
            <ul className="space-y-1 rounded-lg border p-3 font-mono text-xs">
              {d.timeline.map((e, i) => (
                <li key={i}>
                  {new Date(e.at).toLocaleString()} {e.from ?? '—'} → {e.status} by {e.actorType}
                  {e.reason && ` · ${e.reason}`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
