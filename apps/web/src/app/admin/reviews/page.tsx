'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FormError } from '@/components/forms/field';
import { Stars } from '@/components/reviews/stars';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';

interface QueuedReview {
  id: string;
  iieId: string;
  seller: string;
  buyer: string;
  rating: number;
  title: string | null;
  body: string | null;
  status: 'PENDING' | 'PUBLISHED' | 'REJECTED';
  moderationNote: string | null;
  submittedAt: string;
  moderatedAt: string | null;
}

const STATUSES = [
  { key: 'PENDING', label: 'To check' },
  { key: 'PUBLISHED', label: 'Published' },
  { key: 'REJECTED', label: 'Not published' },
] as const;

export default function AdminReviewsPage() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]['key']>('PENDING');
  const { data } = useQuery({ queryKey: ['admin-reviews', status], queryFn: () => api<{ items: QueuedReview[] }>(`/admin/reviews?status=${status}`).then((r) => r.items) });
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Every rating and review is checked before it appears on a product or seller page. Do not publish reviews with contact details, links, abuse or content unrelated to the order. When you decline one, tell the
        buyer why.
      </p>
      <div className="flex gap-2" role="group" aria-label="Filter">
        {STATUSES.map((s) => (
          <button key={s.key} onClick={() => setStatus(s.key)} className={`rounded-full border px-3 py-1 text-sm ${status === s.key ? 'bg-ocean-900 text-white' : ''}`}>
            {s.label}
          </button>
        ))}
      </div>
      <ul className="space-y-3">
        {data?.map((r) => <ReviewCard key={r.id} r={r} />)}
        {data?.length === 0 && <li className="text-sm text-muted-foreground">Nothing here.</li>}
      </ul>
    </div>
  );
}

function ReviewCard({ r }: { r: QueuedReview }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function decide(decision: 'PUBLISH' | 'REJECT') {
    setError(null);
    try {
      await api(`/admin/reviews/${r.id}/moderate`, { method: 'POST', body: { decision, note: note || undefined } });
      await qc.invalidateQueries({ queryKey: ['admin-reviews'] });
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <li className="rounded-lg border p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Stars value={r.rating} />
        {r.title && <span className="font-semibold">{r.title}</span>}
      </div>
      {r.body && <p className="mt-1 whitespace-pre-line">{r.body}</p>}
      <p className="mt-1 text-xs text-muted-foreground">
        {r.buyer} about {r.seller} · <span className="font-mono">{r.iieId}</span> · {new Date(r.submittedAt).toLocaleString()}
      </p>
      {r.moderationNote && <p className="mt-1 text-xs">Reason given: {r.moderationNote}</p>}
      {r.status === 'PENDING' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => decide('PUBLISH')}>
            Publish
          </Button>
          <Input aria-label={`Reason for not publishing the review of ${r.iieId}`} placeholder="Reason, if not publishing" value={note} onChange={(e) => setNote(e.target.value)} className="max-w-sm" maxLength={500} />
          <Button size="sm" variant="outline" onClick={() => decide('REJECT')} disabled={!note.trim()}>
            Don’t publish
          </Button>
        </div>
      )}
      <FormError message={error} />
    </li>
  );
}
