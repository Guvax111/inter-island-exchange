'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { FormError } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, apiForm, errorMessage } from '@/lib/api';
import { DECISION_LABELS, type DisputeView } from '@/lib/types';

const ROLE_LABEL = { BUYER: 'Buyer', SELLER: 'Seller', IIE: 'IIE' } as const;
const AUDIENCE_LABEL = { BOTH: 'buyer and seller', BUYER: 'buyer only', SELLER: 'seller only' } as const;

/**
 * The conversation about a reported problem, and IIE's decision. Buyers and sellers write to IIE only and see only
 * what is addressed to them; IIE sees everything, chooses who each of its messages goes to, and can pass a party's
 * message and photo on to the other side.
 */
export function DisputePanel({ iieId, onChange }: { iieId: string; onChange?: () => void }) {
  const qc = useQueryClient();
  const { data: d } = useQuery({ queryKey: ['dispute', iieId], queryFn: () => api<DisputeView>(`/disputes/${iieId}`) });
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'BOTH' | 'BUYER' | 'SELLER'>('BOTH');
  const photo = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!d) return null;

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('body', body);
    if (d?.yourRole === 'IIE') form.append('audience', audience);
    const f = photo.current?.files?.[0];
    if (f) form.append('photo', f);
    try {
      qc.setQueryData(['dispute', iieId], await apiForm<DisputeView>(`/disputes/${iieId}/messages`, form));
      setBody('');
      if (photo.current) photo.current.value = '';
      onChange?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function share(messageId: string) {
    setError(null);
    try {
      qc.setQueryData(['dispute', iieId], await api<DisputeView>(`/admin/disputes/${iieId}/messages/${messageId}/share`, { method: 'POST', body: {} }));
      onChange?.();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4 text-sm">
      {d.yourRole !== 'IIE' && (
        <p className="text-muted-foreground">
          Your messages go to IIE only. IIE talks to the {d.yourRole === 'BUYER' ? 'seller' : 'buyer'} and shares what is needed; you will not be contacted by them directly.
        </p>
      )}
      {d.decision && (
        <div className="rounded-lg border-l-4 border-ocean-600 bg-ocean-50 p-3">
          <p className="font-semibold">
            IIE decision: {DECISION_LABELS[d.decision]}
            {d.refundAmount && ` · ${d.refundAmount.formatted}`}
          </p>
          <p className="mt-1">{d.decisionNote}</p>
          <p className="mt-1">{d.returnRequired ? <>Goods to be returned: {d.returnInstructions}</> : 'The buyer keeps the goods.'}</p>
          {d.shippingBorneBy && <p className="mt-1">The carrier’s shipping charge is paid by {d.shippingBorneBy === 'SELLER' ? 'the seller' : 'IIE'}.</p>}
        </div>
      )}
      <ol className="space-y-3">
        {d.messages.map((m) => (
          <li key={m.id} className={`rounded-lg border p-3 ${m.role === 'IIE' ? 'bg-ocean-50' : m.role === d.yourRole ? 'bg-muted' : ''}`}>
            <p className="text-xs text-muted-foreground">
              {m.role === 'IIE' ? 'IIE' : m.role === d.yourRole ? 'You' : `${m.author} (${ROLE_LABEL[m.role].toLowerCase()})`} · {new Date(m.at).toLocaleString()}
              {d.yourRole === 'IIE' && m.role === 'IIE' && m.visibleTo && <> · to {AUDIENCE_LABEL[m.visibleTo]}</>}
              {d.yourRole === 'IIE' && m.role !== 'IIE' && <> · seen by IIE only</>}
            </p>
            <p className="mt-1 whitespace-pre-line">{m.body}</p>
            {m.photoUrl && (
              <a href={m.photoUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.photoUrl} alt={`Photo from the ${ROLE_LABEL[m.role].toLowerCase()}`} className="h-28 w-auto rounded border object-cover" />
              </a>
            )}
            {d.yourRole === 'IIE' && d.canMessage && m.role !== 'IIE' && (
              <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => share(m.id)}>
                Share with the {m.role === 'BUYER' ? 'seller' : 'buyer'}
              </Button>
            )}
          </li>
        ))}
      </ol>
      {d.canMessage && (
        <form onSubmit={send} className="space-y-2">
          <Label htmlFor={`dispute-msg-${iieId}`}>{d.yourRole === 'IIE' ? 'Message' : 'Message to IIE (add a photo as evidence if it helps)'}</Label>
          {d.yourRole === 'IIE' && (
            <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Send to">
              {(['BOTH', 'BUYER', 'SELLER'] as const).map((a) => (
                <label key={a} className="flex items-center gap-1">
                  <input type="radio" name={`audience-${iieId}`} checked={audience === a} onChange={() => setAudience(a)} />
                  To the {AUDIENCE_LABEL[a]}
                </label>
              ))}
            </div>
          )}
          <Textarea id={`dispute-msg-${iieId}`} value={body} onChange={(e) => setBody(e.target.value)} minLength={2} maxLength={2000} required />
          <div className="flex flex-wrap items-center gap-2">
            <input ref={photo} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Photo (optional)" className="text-sm" />
            <Button type="submit" size="sm" disabled={busy || body.trim().length < 2}>
              {busy ? 'Sending…' : 'Send'}
            </Button>
          </div>
          <FormError message={error} />
        </form>
      )}
    </div>
  );
}
