'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { DecisionPanel } from '@/components/admin/decision-panel';
import { StatusBadge } from '@/components/marketplace/status-badge';
import { FormError } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';

interface Row {
  id: string;
  legalName: string;
  category: string;
  status: string;
  submittedAt: string | null;
  country: string;
  email: string;
}
interface Detail {
  seller: { id: string; status: string; partyType: string; legalName: string; phone: string; website: string | null; category: string; reviewNotes: string | null; payoutSetupNote: string | null };
  user: { email: string; firstName: string; lastName: string; emailVerifiedAt: string | null };
  business: { legalName: string; tradingName: string | null; registrationNumber: string | null; taxId: string | null } | null;
  storefront: { slug: string } | null;
}

const FILTERS = ['UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'DRAFT', 'SUSPENDED', 'REJECTED'];

export default function AdminSellersPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('UNDER_REVIEW');
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['admin-sellers', status], queryFn: () => api<{ items: Row[]; total: number }>(`/admin/sellers?status=${status}&pageSize=100`) });
  const detail = useQuery({ queryKey: ['admin-seller', selected], enabled: !!selected, queryFn: () => api<Detail>(`/admin/sellers/${selected}`) });
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['admin-sellers'] });
    await qc.invalidateQueries({ queryKey: ['admin-seller', selected] });
  }
  async function act(path: string, body: object) {
    setError(null);
    try {
      await api(`/admin/sellers/${selected}/${path}`, { method: 'POST', body });
      setNote('');
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const d = detail.data;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Button key={f} size="sm" variant={f === status ? 'default' : 'outline'} onClick={() => { setStatus(f); setSelected(null); }}>
              <StatusBadge status={f} />
            </Button>
          ))}
        </div>
        <ul className="divide-y rounded-lg border">
          {!list.data?.items.length && <li className="p-4 text-sm text-muted-foreground">Nothing here.</li>}
          {list.data?.items.map((r) => (
            <li key={r.id}>
              <button className={`w-full p-3 text-left text-sm hover:bg-muted/50 ${selected === r.id ? 'bg-muted' : ''}`} onClick={() => setSelected(r.id)}>
                <p className="font-medium">{r.legalName}</p>
                <p className="text-muted-foreground">
                  {r.country} · {r.category} · {r.email}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        {!d ? (
          <p className="text-sm text-muted-foreground">Select a seller to review.</p>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{d.seller.legalName}</h2>
              <StatusBadge status={d.seller.status} />
            </div>
            <dl className="grid grid-cols-[160px_1fr] gap-1">
              <dt className="text-muted-foreground">Applicant</dt>
              <dd>{d.user.firstName} {d.user.lastName} ({d.user.email}){d.user.emailVerifiedAt ? '' : ' — email not confirmed'}</dd>
              <dt className="text-muted-foreground">Type</dt>
              <dd>{d.seller.partyType === 'BUSINESS' ? 'Registered business' : 'Individual'}</dd>
              {d.business && (
                <>
                  <dt className="text-muted-foreground">Trading name</dt>
                  <dd>{d.business.tradingName ?? '—'}</dd>
                  <dt className="text-muted-foreground">Registration no.</dt>
                  <dd>{d.business.registrationNumber ?? '—'}</dd>
                  <dt className="text-muted-foreground">Tax ID</dt>
                  <dd>{d.business.taxId ?? '—'}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Phone</dt>
              <dd>{d.seller.phone}</dd>
              <dt className="text-muted-foreground">Website</dt>
              <dd>{d.seller.website ?? '—'}</dd>
              <dt className="text-muted-foreground">Category</dt>
              <dd>{d.seller.category}</dd>
              {d.seller.payoutSetupNote && (
                <>
                  <dt className="text-muted-foreground">Payout setup</dt>
                  <dd>{d.seller.payoutSetupNote}</dd>
                </>
              )}
            </dl>
            <FormError message={error} />
            {d.seller.status === 'UNDER_REVIEW' && (
              <DecisionPanel
                onDecide={async (decision, notes) => {
                  await api(`/admin/sellers/${selected}/review`, { method: 'POST', body: { decision, notes: notes || undefined } });
                  await refresh();
                }}
              />
            )}
            {['APPROVED', 'ACTIVE', 'SUSPENDED'].includes(d.seller.status) && (
              <div className="space-y-2 rounded-lg border p-3">
                <Input
                  aria-label="Note"
                  placeholder={d.seller.status === 'APPROVED' ? 'How payouts were arranged (no bank details)' : 'Reason (recorded in the audit log)'}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  {d.seller.status === 'APPROVED' && (
                    <Button size="sm" disabled={note.trim().length < 3} onClick={() => act('payout-setup', { note })}>
                      Confirm payout setup and activate
                    </Button>
                  )}
                  {d.seller.status !== 'SUSPENDED' ? (
                    <Button size="sm" variant="destructive" disabled={note.trim().length < 3} onClick={() => act('suspend', { reason: note })}>
                      Suspend seller
                    </Button>
                  ) : (
                    <Button size="sm" disabled={note.trim().length < 3} onClick={() => act('reinstate', { reason: note })}>
                      Reinstate seller
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
