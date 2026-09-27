'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import type { Money } from '@/lib/types';

interface Payout { iieId: string; status: string; amount: Money; deducted: Money | null; dueAt: string | null; paidAt: string | null; providerReference: string | null }
interface Charge { iieId: string; kind: string; note: string | null; amount: Money; remaining: Money; status: 'OUTSTANDING' | 'RECOVERED'; createdAt: string }

const LABEL: Record<string, string> = { ON_HOLD: 'On hold', APPROVED: 'Approved', PROCESSING: 'Being sent', PAID: 'Paid', FAILED: 'Failed – IIE will retry', CANCELLED: 'Cancelled (refunded)' };

export default function SellerPayoutsPage() {
  const { data: res } = useQuery({ queryKey: ['my-payouts'], queryFn: () => api<{ items: Payout[]; charges: Charge[] }>('/me/payouts') });
  const data = res?.items;
  const outstanding = res?.charges.filter((c) => c.status === 'OUTSTANDING') ?? [];
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
                <TableCell className="text-right">
                  {p.amount.formatted}
                  {p.deducted && <span className="block text-xs text-muted-foreground">after {p.deducted.formatted} kept back</span>}
                </TableCell>
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
      {!!res?.charges.length && (
        <div className="rounded-lg border p-4 text-sm">
          <h2 className="font-semibold">Amounts you owe IIE</h2>
          <p className="mt-1 text-muted-foreground">
            For example the carrier’s shipping on an order IIE refunded in full, when IIE decided you pay it. These are kept back from your next payouts.
            {outstanding.length > 0 && ` Still to be kept back: ${outstanding.map((c) => c.remaining.formatted).join(', ')}.`}
          </p>
          <ul className="mt-2 divide-y">
            {res.charges.map((c) => (
              <li key={`${c.iieId}-${c.kind}`} className="flex justify-between gap-4 py-2">
                <span>
                  <span className="font-mono">{c.iieId}</span> · {c.note ?? c.kind}
                </span>
                <span>
                  {c.status === 'RECOVERED' ? `${c.amount.formatted} settled` : `${c.remaining.formatted} of ${c.amount.formatted} outstanding`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
