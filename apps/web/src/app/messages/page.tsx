'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { RequireSignIn } from '@/components/account/require-signin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { CONTACT } from '@/lib/navigation';
import type { SupportThreadSummary } from '@/lib/types';

export default function MessagesPage() {
  return (
    <section className="container max-w-3xl py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-ocean-900">Messages</h1>
        <Button asChild>
          <Link href="/messages/new">New message</Link>
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Your conversations with IIE. Buyers and sellers do not message each other directly: write to IIE and we will help, or pass on what is needed. For a problem with a delivered order, use <strong>Report a problem</strong> on the order page. IIE replies {CONTACT.hours}.
      </p>
      <RequireSignIn>{() => <Threads />}</RequireSignIn>
    </section>
  );
}

function Threads() {
  const { data } = useQuery({ queryKey: ['my-messages'], queryFn: () => api<{ items: SupportThreadSummary[] }>('/me/messages').then((r) => r.items) });
  if (!data) return <p className="mt-4 text-muted-foreground">Loading…</p>;
  if (!data.length) return <p className="mt-6 text-muted-foreground">No messages yet.</p>;
  return (
    <ul className="mt-6 divide-y rounded-lg border">
      {data.map((t) => (
        <li key={t.id}>
          <Link href={`/messages/${t.id}`} className="flex items-center justify-between gap-3 p-3 hover:bg-muted">
            <span>
              <span className="font-medium">{t.subject}</span>
              <span className="block text-xs text-muted-foreground">
                {t.iieId && <span className="font-mono">{t.iieId} · </span>}
                {new Date(t.lastMessageAt).toLocaleString()}
              </span>
            </span>
            {t.status === 'CLOSED' ? <Badge variant="secondary">Closed</Badge> : t.waitingFor === 'USER' ? <Badge>IIE replied</Badge> : <Badge variant="outline">Waiting for IIE</Badge>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
