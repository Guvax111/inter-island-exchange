'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { FormError } from '@/components/forms/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/session';

interface Figures {
  period: { from: string; to: string; label: string };
  orders: Record<string, number>;
  money: { currency: string; paidOrders: number; grossSales: string; iieFees: string; refunds: string; refundCount: number; sellerPayouts: string; payoutCount: number }[];
  disputes: Record<string, number>;
  growth: Record<string, number>;
  waitingOnIie: Record<string, number>;
  lanes: { lane: string; orders: number; grossSales: string }[];
  settlements: Record<'owedToIie' | 'owedByIie', { overdue: string[]; dueNext14Days: string[]; settledThisWeek: string[] }>;
}
interface Recipient { id: string; email: string; name: string; active: boolean }
interface Run { id: string; kind: 'SCHEDULED' | 'MANUAL'; weekStart: string; recipients: number; sentAt: string }

const LABELS: Record<string, string> = {
  placed: 'Placed',
  paid: 'Paid',
  delivered: 'Delivered',
  completed: 'Completed (seller paid)',
  cancelled: 'Cancelled (not paid)',
  refunded: 'Refunded in full',
  inProgress: 'In progress now',
  opened: 'Opened',
  decided: 'Decided',
  openNow: 'Open now',
  newAccounts: 'New accounts',
  sellersApproved: 'Sellers approved',
  productsPublished: 'Products published',
  reviewsPublished: 'Reviews published',
  sellersToReview: 'Sellers to review',
  productsToReview: 'Products to review',
  reviewsToModerate: 'Reviews to moderate',
  messagesAwaitingReply: 'Messages awaiting a reply',
  openDisputes: 'Open disputes',
  ordersOnHold: 'Orders on hold',
};

export default function AdminReportsPage() {
  const { data: me } = useMe();
  const [weekOf, setWeekOf] = useState('');
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: f } = useQuery({ queryKey: ['weekly-report', weekOf], queryFn: () => api<Figures>(`/admin/reports/weekly${weekOf ? `?weekOf=${weekOf}` : ''}`) });
  const { data: runs } = useQuery({ queryKey: ['report-runs'], queryFn: () => api<{ items: Run[] }>('/admin/reports/runs').then((r) => r.items) });

  async function sendNow() {
    if (!confirm(`Email the report for ${f?.period.label} to all active recipients now?`)) return;
    setError(null);
    setMessage(null);
    try {
      const r = await api<{ recipients: number }>(`/admin/reports/weekly/send${weekOf ? `?weekOf=${weekOf}` : ''}`, { method: 'POST', body: {} });
      setMessage(`Sent to ${r.recipients} ${r.recipients === 1 ? 'recipient' : 'recipients'}.`);
      await qc.invalidateQueries({ queryKey: ['report-runs'] });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        The directors’ report is emailed every <strong>Monday at 08:00 St. Vincent time</strong> for the week that just ended (Monday to Sunday). Preview any week here, or send it now.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="week-of">Week containing</Label>
          <Input id="week-of" type="date" value={weekOf} onChange={(e) => setWeekOf(e.target.value)} className="w-44" />
        </div>
        <Button variant="outline" onClick={sendNow}>
          Send this report now
        </Button>
        {message && <p className="text-sm text-palm-700">{message}</p>}
        <FormError message={error} />
      </div>
      {f && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Week of {f.period.label}</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Block title="Orders" rows={Object.entries(f.orders).map(([k, v]) => [LABELS[k] ?? k, v])} />
            {f.money.length ? (
              f.money.map((m) => (
                <Block
                  key={m.currency}
                  title={`Money (${m.currency})`}
                  rows={[
                    ['Gross sales (paid orders)', `${m.grossSales} (${m.paidOrders})`],
                    ['IIE fees', m.iieFees],
                    ['Refunds', `${m.refunds} (${m.refundCount})`],
                    ['Paid to sellers', `${m.sellerPayouts} (${m.payoutCount})`],
                  ]}
                />
              ))
            ) : (
              <Block title="Money" rows={[['No payments, refunds or payouts', '']]} />
            )}
            <Block
              title="Owed between IIE and partners"
              rows={[
                ['Provider to IIE: overdue', f.settlements.owedToIie.overdue.join(', ') || 'none'],
                ['Provider to IIE: due in 14 days', f.settlements.owedToIie.dueNext14Days.join(', ') || 'none'],
                ['IIE to partners: overdue', f.settlements.owedByIie.overdue.join(', ') || 'none'],
                ['IIE to partners: due in 14 days', f.settlements.owedByIie.dueNext14Days.join(', ') || 'none'],
              ]}
            />
            <Block title="Disputes" rows={Object.entries(f.disputes).map(([k, v]) => [LABELS[k] ?? k, v])} />
            <Block title="Growth" rows={Object.entries(f.growth).map(([k, v]) => [LABELS[k] ?? k, v])} />
            <Block title="Waiting on IIE" rows={Object.entries(f.waitingOnIie).map(([k, v]) => [LABELS[k] ?? k, v])} />
            <Block title="Trade lanes (paid orders)" rows={f.lanes.length ? f.lanes.map((l) => [l.lane, `${l.orders} · ${l.grossSales}`]) : [['No paid orders', '']]} />
          </div>
        </div>
      )}
      <Recipients canManage={!!me?.permissions.includes('config.manage')} />
      <div>
        <h2 className="text-lg font-semibold">Sent</h2>
        <ul className="mt-2 divide-y rounded-lg border text-sm">
          {runs?.map((r) => (
            <li key={r.id} className="flex justify-between gap-3 p-2">
              <span>
                Week of {new Date(r.weekStart).toLocaleDateString(undefined, { timeZone: 'America/St_Vincent' })} <Badge variant="secondary">{r.kind === 'SCHEDULED' ? 'Monday email' : 'Sent by hand'}</Badge>
              </span>
              <span className="text-muted-foreground">
                {r.recipients} {r.recipients === 1 ? "recipient" : "recipients"} · {new Date(r.sentAt).toLocaleString()}
              </span>
            </li>
          ))}
          {runs?.length === 0 && <li className="p-2 text-muted-foreground">Nothing sent yet.</li>}
        </ul>
      </div>
    </div>
  );
}

function Block({ title, rows }: { title: string; rows: [string, string | number][] }) {
  return (
    <div className="rounded-lg border p-4 text-sm">
      <h3 className="font-semibold text-ocean-900">{title}</h3>
      <dl className="mt-2 divide-y">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 py-1">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Recipients({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['report-recipients'], queryFn: () => api<{ items: Recipient[] }>('/admin/reports/recipients').then((r) => r.items) });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/admin/reports/recipients', { method: 'POST', body: { name, email } });
      setName('');
      setEmail('');
      await qc.invalidateQueries({ queryKey: ['report-recipients'] });
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function toggle(r: Recipient) {
    await api(`/admin/reports/recipients/${r.id}/${r.active ? 'disable' : 'enable'}`, { method: 'POST', body: {} });
    await qc.invalidateQueries({ queryKey: ['report-recipients'] });
  }
  return (
    <div>
      <h2 className="text-lg font-semibold">Recipients</h2>
      <ul className="mt-2 divide-y rounded-lg border text-sm">
        {data?.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 p-2">
            <span className={r.active ? '' : 'text-muted-foreground line-through'}>
              {r.name} · {r.email}
            </span>
            {canManage && (
              <Button size="sm" variant="ghost" onClick={() => toggle(r)}>
                {r.active ? 'Stop sending' : 'Send again'}
              </Button>
            )}
          </li>
        ))}
        {data?.length === 0 && <li className="p-2 text-muted-foreground">No recipients yet: add the directors below.</li>}
      </ul>
      {canManage && (
        <form onSubmit={add} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="rcpt-name">Name</Label>
            <Input id="rcpt-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rcpt-email">Email</Label>
            <Input id="rcpt-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <Button type="submit">Add recipient</Button>
          <FormError message={error} />
        </form>
      )}
    </div>
  );
}
