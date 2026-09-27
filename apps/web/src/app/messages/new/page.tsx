'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { RequireSignIn } from '@/components/account/require-signin';
import { FormError } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import type { SupportThread } from '@/lib/types';

export default function NewMessagePage() {
  return (
    <section className="container max-w-2xl py-8">
      <h1 className="text-3xl font-bold text-ocean-900">Message IIE</h1>
      <RequireSignIn>
        {() => (
          <Suspense>
            <NewMessage />
          </Suspense>
        )}
      </RequireSignIn>
    </section>
  );
}

function NewMessage() {
  const router = useRouter();
  const order = useSearchParams().get('order') ?? '';
  const [iieId, setIieId] = useState(order);
  const [subject, setSubject] = useState(order ? `About order ${order}` : '');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const t = await api<SupportThread>('/me/messages', { method: 'POST', body: { subject, body, iieId: iieId.trim() || undefined } });
      router.push(`/messages/${t.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <div className="space-y-1">
        <Label htmlFor="msg-order">Order number (optional)</Label>
        <Input id="msg-order" value={iieId} onChange={(e) => setIieId(e.target.value)} placeholder="IIE-SLU-SVG-000001" maxLength={40} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="msg-subject">Subject</Label>
        <Input id="msg-subject" value={subject} onChange={(e) => setSubject(e.target.value)} required minLength={3} maxLength={150} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="msg-body">Message</Label>
        <Textarea id="msg-body" value={body} onChange={(e) => setBody(e.target.value)} required minLength={2} maxLength={4000} rows={6} />
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Send to IIE'}
      </Button>
      <FormError message={error} />
    </form>
  );
}
