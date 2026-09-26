'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RequireSignIn } from '@/components/account/require-signin';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { NotificationList } from '@/lib/types';

export default function NotificationsPage() {
  return (
    <section className="container max-w-3xl py-8">
      <h1 className="text-3xl font-bold text-ocean-900">Notifications</h1>
      <RequireSignIn>{() => <List />}</RequireSignIn>
    </section>
  );
}

function List() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => api<NotificationList>('/me/notifications') });
  async function markAll() {
    await api('/me/notifications/read', { method: 'POST', body: {} });
    await qc.invalidateQueries({ queryKey: ['notifications'] });
  }
  if (!data) return <p className="mt-4 text-muted-foreground">Loading…</p>;
  return (
    <div className="mt-6 space-y-3">
      {data.unread > 0 && (
        <Button size="sm" variant="outline" onClick={markAll}>
          Mark all as read
        </Button>
      )}
      {!data.items.length && <p className="text-muted-foreground">Nothing yet.</p>}
      <ul className="divide-y rounded-lg border">
        {data.items.map((n) => (
          <li key={n.id} className={`p-4 ${n.readAt ? '' : 'bg-ocean-50'}`}>
            <p className="font-medium">{n.link ? <Link href={n.link} className="underline-offset-2 hover:underline">{n.title}</Link> : n.title}</p>
            <p className="text-sm text-muted-foreground">{n.body}</p>
            <p className="mt-1 text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
