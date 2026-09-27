'use client';

import { useState, type FormEvent } from 'react';
import { FormError } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import type { OrderDetail, OwnReview } from '@/lib/types';
import { Stars } from './stars';

const STATUS_TEXT: Record<OwnReview['status'], string> = {
  PENDING: 'Waiting for IIE to check it before it is published.',
  PUBLISHED: 'Published on the seller’s page.',
  REJECTED: 'Not published.',
};

/** The buyer's rating and review of an order: the form once delivery is confirmed, then its moderation status. */
export function ReviewPanel({ order, onSaved }: { order: OrderDetail; onSaved: () => void }) {
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (order.review) {
    const r = order.review;
    return (
      <div className="space-y-1 text-sm">
        <Stars value={r.rating} />
        {r.title && <p className="font-semibold">{r.title}</p>}
        {r.body && <p className="whitespace-pre-line">{r.body}</p>}
        <p className="text-muted-foreground">{STATUS_TEXT[r.status]}</p>
        {r.moderationNote && <p className="text-muted-foreground">IIE: {r.moderationNote}</p>}
      </div>
    );
  }
  if (!order.canReview) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/me/orders/${order.iieId}/review`, { method: 'POST', body: { rating, title: title || undefined, body: body || undefined } });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-sm">
      <fieldset>
        <legend className="font-medium">Your rating</legend>
        <div className="mt-1 flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer text-2xl text-amber-500">
              <input type="radio" name="rating" value={n} className="sr-only" checked={rating === n} onChange={() => setRating(n)} aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`} />
              <span aria-hidden="true" className={n <= rating ? '' : 'text-slate-300'}>
                ★
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1">
        <Label htmlFor="review-title">Title (optional)</Label>
        <Input id="review-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="review-body">Your review (optional)</Label>
        <Textarea id="review-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
      </div>
      <p className="text-xs text-muted-foreground">IIE checks every review before it is published. Please do not include phone numbers, emails or links.</p>
      <Button type="submit" size="sm" disabled={busy || rating === 0}>
        {busy ? 'Sending…' : 'Submit review'}
      </Button>
      <FormError message={error} />
    </form>
  );
}
