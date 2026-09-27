'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ThreadView } from '@/components/support/thread-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { SupportThread, SupportThreadSummary } from '@/lib/types';

const FILTERS = [
  { key: 'waiting', label: 'Needs reply', query: 'status=OPEN&waiting=true' },
  { key: 'open', label: 'Open', query: 'status=OPEN' },
  { key: 'closed', label: 'Closed', query: 'status=CLOSED' },
];

export default function AdminSupportPage() {
  const [filter, setFilter] = useState(FILTERS[0]!);
  const [selected, setSelected] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ['admin-support', filter.key], queryFn: () => api<{ items: SupportThreadSummary[] }>(`/admin/support?${filter.query}`).then((r) => r.items) });
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1.3fr]">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Messages from buyers, sellers and partners. They cannot contact each other directly, so every question comes here.</p>
        <div className="flex gap-2" role="group" aria-label="Filter">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1 text-sm ${filter.key === f.key ? 'bg-ocean-900 text-white' : ''}`}>
              {f.label}
            </button>
          ))}
        </div>
        <ul className="divide-y rounded-lg border">
          {data?.map((t) => (
            <li key={t.id}>
              <button onClick={() => setSelected(t.id)} className={`w-full p-3 text-left hover:bg-muted ${selected === t.id ? 'bg-muted' : ''}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{t.subject}</span>
                  {t.waitingFor === 'IIE' && t.status === 'OPEN' && <Badge>Needs reply</Badge>}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t.user?.firstName} {t.user?.lastName} · {t.user?.email}
                  {t.iieId && <> · <span className="font-mono">{t.iieId}</span></>} · {new Date(t.lastMessageAt).toLocaleString()}
                </span>
              </button>
            </li>
          ))}
          {data?.length === 0 && <li className="p-3 text-sm text-muted-foreground">No conversations.</li>}
        </ul>
      </div>
      {selected && <StaffThread id={selected} />}
    </div>
  );
}

function StaffThread({ id }: { id: string }) {
  const qc = useQueryClient();
  const { data: t } = useQuery({ queryKey: ['admin-support-thread', id], queryFn: () => api<SupportThread>(`/admin/support/${id}`) });
  if (!t) return null;
  const refresh = async (next: SupportThread) => {
    qc.setQueryData(['admin-support-thread', id], next);
    await qc.invalidateQueries({ queryKey: ['admin-support'] });
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{t.subject}</h2>
          <p className="text-sm text-muted-foreground">
            {t.user?.firstName} {t.user?.lastName} · {t.user?.email}
            {t.iieId && <> · order <span className="font-mono">{t.iieId}</span></>}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={async () => refresh(await api<SupportThread>(`/admin/support/${id}/${t.status === 'OPEN' ? 'close' : 'reopen'}`, { method: 'POST', body: {} }))}>
          {t.status === 'OPEN' ? 'Close' : 'Reopen'}
        </Button>
      </div>
      <ThreadView thread={t} staff onReply={async (body) => refresh(await api<SupportThread>(`/admin/support/${id}/messages`, { method: 'POST', body: { body } }))} />
    </div>
  );
}
