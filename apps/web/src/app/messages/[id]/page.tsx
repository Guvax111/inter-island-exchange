'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RequireSignIn } from '@/components/account/require-signin';
import { ThreadView } from '@/components/support/thread-view';
import { api } from '@/lib/api';
import type { SupportThread } from '@/lib/types';

export default function MessageThreadPage() {
  return (
    <section className="container max-w-3xl py-8">
      <RequireSignIn>{() => <Thread />}</RequireSignIn>
    </section>
  );
}

function Thread() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: t, error } = useQuery({ queryKey: ['my-message', id], queryFn: () => api<SupportThread>(`/me/messages/${id}`) });
  if (error) return <p className="text-muted-foreground">Conversation not found. <Link href="/messages" className="underline">Messages</Link></p>;
  if (!t) return <p className="text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-4">
      <Link href="/messages" className="text-sm underline">
        All messages
      </Link>
      <h1 className="text-2xl font-bold text-ocean-900">{t.subject}</h1>
      {t.iieId && (
        <p className="text-sm">
          About order <span className="font-mono">{t.iieId}</span>
        </p>
      )}
      <ThreadView
        thread={t}
        staff={false}
        onReply={async (body) => {
          qc.setQueryData(['my-message', id], await api<SupportThread>(`/me/messages/${id}/messages`, { method: 'POST', body: { body } }));
          await qc.invalidateQueries({ queryKey: ['my-messages'] });
        }}
      />
    </div>
  );
}
