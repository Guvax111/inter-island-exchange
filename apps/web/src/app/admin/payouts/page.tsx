'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import type { Money } from '@/lib/types';

interface Payout { iieId: string; seller: string; status: string; amount: Money; createdAt: string }

const FILTERS = ['', 'ON_HOLD', 'CANCELLED'];

export default function AdminPayoutsPage() {
  const [status, setStatus] = useState('');
  const { data } = useQuery({ queryKey: ['payouts', status], queryFn: () => api<{ items: Payout[] }>(`/admin/payouts${status ? `?status=${status}` : ''}`) });
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        A seller payout is created when the buyer pays and stays <strong>on hold</strong> with the payment provider until delivery is confirmed and the dispute window closes. Releasing payouts arrives with
        delivery confirmation in a later phase; refunded orders cancel their payout.
      </p>
      <div className="flex gap-2" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setStatus(f)} className={`rounded-full border px-3 py-1 text-sm ${status === f ? 'bg-ocean-900 text-white' : ''}`}>
            {f ? f.replace('_', ' ').toLowerCase() : 'all'}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Transaction</TableHead>
              <TableHead>Seller</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((p) => (
              <TableRow key={p.iieId}>
                <TableCell className="font-mono text-sm">{p.iieId}</TableCell>
                <TableCell>{p.seller}</TableCell>
                <TableCell>
                  <Badge variant={p.status === 'ON_HOLD' ? 'secondary' : 'outline'}>{p.status.replace('_', ' ').toLowerCase()}</Badge>
                </TableCell>
                <TableCell className="text-right">{p.amount.formatted}</TableCell>
              </TableRow>
            ))}
            {data?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No payouts.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
