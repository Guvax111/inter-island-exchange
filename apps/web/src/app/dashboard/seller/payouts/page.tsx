'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import type { Money } from '@/lib/types';

interface Payout { iieId: string; status: string; amount: Money; dueAt: string | null; paidAt: string | null; providerReference: string | null }

const LABEL: Record<string, string> = { ON_HOLD: 'On hold', APPROVED: 'Approved', PROCESSING: 'Being sent', PAID: 'Paid', FAILED: 'Failed – IIE will retry', CANCELLED: 'Cancelled (refunded)' };

export default function SellerPayoutsPage() {
  const { data } = useQuery({ queryKey: ['my-payouts'], queryFn: () => api<{ items: Payout[] }>('/me/payouts').then((r) => r.items) });
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        The payment provider holds each buyer’s payment. You are paid 7 days after the buyer confirms delivery, if no problem is reported. Payouts in test mode are sandbox transfers: no real money moves.
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>When</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.map((p) => (
              <TableRow key={p.iieId}>
                <TableCell>
                  <Link href={`/dashboard/seller/orders/${p.iieId}`} className="font-mono text-sm underline">
                    {p.iieId}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={p.status === 'PAID' ? 'default' : 'secondary'}>{LABEL[p.status] ?? p.status}</Badge>
                </TableCell>
                <TableCell className="text-sm">
                  {p.paidAt ? `Paid ${new Date(p.paidAt).toLocaleDateString()}` : p.dueAt ? `Due ${new Date(p.dueAt).toLocaleDateString()}` : '—'}
                </TableCell>
                <TableCell className="text-right">{p.amount.formatted}</TableCell>
              </TableRow>
            ))}
            {data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No payouts yet. A payout is created when a buyer pays.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
