'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FormError } from '@/components/forms/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, errorMessage } from '@/lib/api';

interface CountryRow {
  code: string;
  name: string;
  iieCode: string;
  slug: string;
  marketplaceEnabled: boolean;
  currency: { code: string };
  info: { tagline?: string };
}
interface Lane {
  origin: string;
  originName: string;
  destination: string;
  destinationName: string;
  enabled: boolean;
}

export default function AdminCountriesPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ code: string; tagline: string } | null>(null);
  const { data: countries } = useQuery({ queryKey: ['countries'], queryFn: () => api<{ items: CountryRow[] }>('/countries').then((r) => r.items) });
  const { data: lanes } = useQuery({ queryKey: ['admin-lanes'], queryFn: () => api<{ items: Lane[] }>('/admin/lanes').then((r) => r.items) });

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['countries'] });
      await qc.invalidateQueries({ queryKey: ['admin-lanes'] });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function saveTagline() {
    if (!editing) return;
    await run(async () => {
      const current = await api<{ settings: Record<string, unknown> }>(`/admin/countries/${editing.code}`);
      const publicInfo = { ...((current.settings.public as Record<string, unknown>) ?? {}), tagline: editing.tagline };
      await api(`/admin/countries/${editing.code}`, { method: 'PATCH', body: { settings: { ...current.settings, public: publicInfo } } });
      setEditing(null);
    });
  }

  return (
    <div className="space-y-8">
      <FormError message={error} />
      <p className="text-sm text-muted-foreground">Changes are saved immediately and appear on public country pages within about a minute.</p>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Country</TableHead>
              <TableHead>IIE code</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead>Page</TableHead>
              <TableHead>Marketplace</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {countries?.map((c) => (
              <TableRow key={c.code}>
                <TableCell>
                  <p className="font-medium">{c.name}</p>
                  {editing?.code === c.code ? (
                    <div className="mt-2 flex gap-2">
                      <Input aria-label="Public tagline" value={editing.tagline} onChange={(e) => setEditing({ ...editing, tagline: e.target.value })} />
                      <Button size="sm" onClick={saveTagline}>Save</Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{c.info.tagline ?? 'No tagline'}</p>
                  )}
                </TableCell>
                <TableCell>{c.iieCode}</TableCell>
                <TableCell>{c.currency.code}</TableCell>
                <TableCell><a href={`/${c.slug}`} className="text-ocean-700 underline">/{c.slug}</a></TableCell>
                <TableCell><Badge variant={c.marketplaceEnabled ? 'default' : 'secondary'}>{c.marketplaceEnabled ? 'Open' : 'Closed'}</Badge></TableCell>
                <TableCell className="space-x-2 whitespace-nowrap text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ code: c.code, tagline: c.info.tagline ?? '' })}>Edit tagline</Button>
                  <Button size="sm" variant="outline" onClick={() => run(() => api(`/admin/countries/${c.code}`, { method: 'PATCH', body: { marketplaceEnabled: !c.marketplaceEnabled } }))}>
                    {c.marketplaceEnabled ? 'Close' : 'Open'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div>
        <h2 className="text-lg font-semibold">Trade lanes</h2>
        <ul className="mt-3 divide-y rounded-lg border">
          {lanes?.map((l) => (
            <li key={`${l.origin}-${l.destination}`} className="flex items-center justify-between gap-2 p-3 text-sm">
              <span>{l.originName} → {l.destinationName}</span>
              <Button size="sm" variant="outline" onClick={() => run(() => api('/admin/lanes', { method: 'PUT', body: { origin: l.origin, destination: l.destination, enabled: !l.enabled } }))}>
                {l.enabled ? 'Close lane' : 'Open lane'}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
