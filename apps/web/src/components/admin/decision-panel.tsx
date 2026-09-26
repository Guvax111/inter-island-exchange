'use client';

import { useState } from 'react';
import { FormError } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/api';

/** Approve / request changes / reject, with notes required for anything but approval. */
export function DecisionPanel({ onDecide }: { onDecide: (decision: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES', notes: string) => Promise<void> }) {
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function decide(decision: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES') {
    setError(null);
    setBusy(true);
    try {
      await onDecide(decision, notes);
      setNotes('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const needsNotes = notes.trim().length < 3;
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <FormError message={error} />
      <label className="block text-sm font-medium" htmlFor="decision-notes">
        Notes to the seller (required to reject or request changes; recorded in the audit log)
      </label>
      <Textarea id="decision-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => decide('APPROVE')}>Approve</Button>
        <Button size="sm" variant="outline" disabled={busy || needsNotes} onClick={() => decide('REQUEST_CHANGES')}>Request changes</Button>
        <Button size="sm" variant="destructive" disabled={busy || needsNotes} onClick={() => decide('REJECT')}>Reject</Button>
      </div>
    </div>
  );
}
