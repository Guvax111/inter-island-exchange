'use client';

import { useState, type FormEvent } from 'react';
import { FormError } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/api';
import type { SupportThread } from '@/lib/types';

/** A conversation with IIE, for the user or for IIE staff (`staff` shows the user's details and staff names). */
export function ThreadView({ thread, staff, onReply }: { thread: SupportThread; staff: boolean; onReply: (body: string) => Promise<void> }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onReply(body);
      setBody('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <ol className="space-y-3">
        {thread.messages.map((m, i) => (
          <li key={i} className={`rounded-lg border p-3 ${m.role === 'IIE' ? 'bg-ocean-50' : 'bg-muted'}`}>
            <p className="text-xs text-muted-foreground">
              {m.role === 'IIE' ? (staff ? `${m.author} (IIE)` : 'IIE') : staff ? `${m.author} (user)` : 'You'} · {new Date(m.at).toLocaleString()}
            </p>
            <p className="mt-1 whitespace-pre-line">{m.body}</p>
          </li>
        ))}
      </ol>
      <form onSubmit={submit} className="space-y-2">
        <Label htmlFor={`reply-${thread.id}`}>{staff ? 'Reply to the user' : 'Reply'}</Label>
        {thread.status === 'CLOSED' && !staff && <p className="text-muted-foreground">This conversation is closed. Replying reopens it.</p>}
        <Textarea id={`reply-${thread.id}`} value={body} onChange={(e) => setBody(e.target.value)} required minLength={2} maxLength={4000} />
        <Button type="submit" size="sm" disabled={busy || body.trim().length < 2}>
          {busy ? 'Sending…' : 'Send'}
        </Button>
        <FormError message={error} />
      </form>
    </div>
  );
}
