'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { DisputePanel } from '@/components/disputes/dispute-panel';
import { FormError } from '@/components/forms/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { DECISION_LABELS, type DisputeView, type Money } from '@/lib/types';
import { useMe } from '@/lib/session';

interface Row { iieId: string; status: string; decision: DisputeView['decision']; reason: string; total: Money; openedAt: string }

export default function AdminDisputesPage() {
  const [status, setStatus] = useState<'OPEN' | 'ALL'>('OPEN');
  const [selected, setSelected] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ['admin-disputes', status], queryFn: () => api<{ items: Row[] }>(`/admin/disputes?status=${status}`).then((r) => r.items) });
  const { data: me } = useMe();
  const canDecide = !!me?.permissions.includes('dispute.resolve');
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1.3fr]">
      <div className="space-y-3">
        <div className="flex gap-2" role="group" aria-label="Filter">
          {(['OPEN', 'ALL'] as const).map((f) => (
            <button key={f} onClick={() => setStatus(f)} className={`rounded-full border px-3 py-1 text-sm ${status === f ? 'bg-ocean-900 text-white' : ''}`}>
              {f === 'OPEN' ? 'Open' : 'All'}
            </button>
          ))}
        </div>
        <ul className="divide-y rounded-lg border">
          {data?.map((d) => (
            <li key={d.iieId}>
              <button onClick={() => setSelected(d.iieId)} className={`w-full p-3 text-left hover:bg-muted ${selected === d.iieId ? 'bg-muted' : ''}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold">{d.iieId}</span>
                  <Badge variant={d.status === 'OPEN' ? 'default' : 'secondary'}>{d.decision ? DECISION_LABELS[d.decision] : 'Open'}</Badge>
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {d.reason.slice(0, 120)} · {d.total.formatted} · {new Date(d.openedAt).toLocaleDateString()}
                </span>
              </button>
            </li>
          ))}
          {data?.length === 0 && <li className="p-3 text-sm text-muted-foreground">No {status === 'OPEN' ? 'open ' : ''}disputes.</li>}
        </ul>
      </div>
      {selected && (
        <div className="space-y-4">
          <h2 className="font-mono text-lg font-semibold">{selected}</h2>
          <DisputePanel iieId={selected} />
          {canDecide && <DecisionForm iieId={selected} />}
        </div>
      )}
    </div>
  );
}

function DecisionForm({ iieId }: { iieId: string }) {
  const qc = useQueryClient();
  const { data: d } = useQuery({ queryKey: ['dispute', iieId], queryFn: () => api<DisputeView>(`/disputes/${iieId}`) });
  const [decision, setDecision] = useState<'FULL_REFUND' | 'PARTIAL_REFUND' | 'RELEASE_TO_SELLER'>('PARTIAL_REFUND');
  const [refundAmount, setRefundAmount] = useState('');
  const [returnRequired, setReturnRequired] = useState(false);
  const [returnInstructions, setReturnInstructions] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!d || d.disputeStatus !== 'OPEN') return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!confirm(`Record this decision for ${iieId}? Refunds and payouts are sent to the payment provider immediately.`)) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api<DisputeView>(`/admin/disputes/${iieId}/decision`, {
        method: 'POST',
        body: { decision, refundAmount: decision === 'PARTIAL_REFUND' ? refundAmount : undefined, returnRequired, returnInstructions: returnRequired ? returnInstructions : undefined, note },
      });
      qc.setQueryData(['dispute', iieId], updated);
      await qc.invalidateQueries({ queryKey: ['admin-disputes'] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border p-4 text-sm">
      <p className="font-semibold">Decision</p>
      <p className="text-muted-foreground">
        Order total {d.limits?.total.formatted}. A partial refund comes out of the seller’s payout (at most {d.limits?.maxPartialRefund?.formatted ?? '—'}).
      </p>
      <fieldset className="space-y-1">
        <legend className="sr-only">Outcome</legend>
        {(['FULL_REFUND', 'PARTIAL_REFUND', 'RELEASE_TO_SELLER'] as const).map((k) => (
          <label key={k} className="flex items-center gap-2">
            <input type="radio" name="decision" checked={decision === k} onChange={() => setDecision(k)} />
            {DECISION_LABELS[k]}
          </label>
        ))}
      </fieldset>
      {decision === 'PARTIAL_REFUND' && (
        <div className="max-w-xs space-y-1">
          <Label htmlFor="refund-amount">Refund amount</Label>
          <Input id="refund-amount" inputMode="decimal" placeholder="e.g. 22.50" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} required />
        </div>
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={returnRequired} onChange={(e) => setReturnRequired(e.target.checked)} />
        The buyer must return the goods
      </label>
      {returnRequired && (
        <div className="space-y-1">
          <Label htmlFor="return-instructions">How and where to return them</Label>
          <Textarea id="return-instructions" value={returnInstructions} onChange={(e) => setReturnInstructions(e.target.value)} required maxLength={1000} />
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="decision-note">Explanation for the buyer and the seller</Label>
        <Textarea id="decision-note" value={note} onChange={(e) => setNote(e.target.value)} required minLength={10} maxLength={2000} />
      </div>
      <Button type="submit" disabled={busy || note.trim().length < 10}>
        {busy ? 'Recording…' : 'Record decision'}
      </Button>
      <FormError message={error} />
    </form>
  );
}
