'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { DecisionPanel } from '@/components/admin/decision-panel';
import { StatusBadge } from '@/components/marketplace/status-badge';
import { FormError } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import type { SellerProduct } from '@/lib/types';

interface Row {
  id: string;
  title: string;
  status: string;
  hsCode: string | null;
  seller: string;
  country: string;
}
const FILTERS = ['PENDING_REVIEW', 'ACTIVE', 'OUT_OF_STOCK', 'SUSPENDED', 'REJECTED', 'DRAFT'];

export default function AdminProductsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('PENDING_REVIEW');
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['admin-products', status], queryFn: () => api<{ items: Row[] }>(`/admin/products?status=${status}&pageSize=100`) });
  const detail = useQuery({ queryKey: ['admin-product', selected], enabled: !!selected, queryFn: () => api<SellerProduct & { seller: { legalName: string } }>(`/admin/products/${selected}`) });
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['admin-products'] });
    await qc.invalidateQueries({ queryKey: ['admin-product', selected] });
  };
  const p = detail.data;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Button key={f} size="sm" variant={f === status ? 'default' : 'outline'} onClick={() => { setStatus(f); setSelected(null); }}>
              <StatusBadge status={f} />
            </Button>
          ))}
        </div>
        <ul className="divide-y rounded-lg border">
          {!list.data?.items.length && <li className="p-4 text-sm text-muted-foreground">Nothing here.</li>}
          {list.data?.items.map((r) => (
            <li key={r.id}>
              <button className={`w-full p-3 text-left text-sm hover:bg-muted/50 ${selected === r.id ? 'bg-muted' : ''}`} onClick={() => setSelected(r.id)}>
                <p className="font-medium">{r.title}</p>
                <p className="text-muted-foreground">{r.seller} · {r.country} · HS {r.hsCode ?? '—'}</p>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        {!p ? (
          <p className="text-sm text-muted-foreground">Select a product to review.</p>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{p.title}</h2>
              <StatusBadge status={p.status} />
            </div>
            <p className="text-muted-foreground">by {p.seller.legalName}</p>
            <div className="grid grid-cols-4 gap-2">
              {p.images.map((img) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={img.id} src={img.url} alt={img.altText} className="aspect-square w-full rounded border object-cover" />
              ))}
            </div>
            <p>{p.shortDescription}</p>
            <p className="whitespace-pre-line text-muted-foreground">{p.description}</p>
            <dl className="grid grid-cols-[160px_1fr] gap-1">
              <dt className="text-muted-foreground">Category</dt>
              <dd>{p.categoryPath.map((c) => c.name).join(' › ')}</dd>
              <dt className="text-muted-foreground">HS code</dt>
              <dd>{p.hsCode ?? '—'}</dd>
              <dt className="text-muted-foreground">Origin</dt>
              <dd>{p.countryOfOrigin?.name}</dd>
              <dt className="text-muted-foreground">Weight / size</dt>
              <dd>{p.weightGrams} g · {p.lengthMm}×{p.widthMm}×{p.heightMm} mm</dd>
              <dt className="text-muted-foreground">Options</dt>
              <dd>{p.variants.map((v) => `${v.name} (${v.sku}) ${v.price.formatted}, ${v.quantityOnHand} in stock`).join('; ')}</dd>
            </dl>
            <FormError message={error} />
            {p.status === 'PENDING_REVIEW' && (
              <DecisionPanel
                onDecide={async (decision, notes) => {
                  await api(`/admin/products/${selected}/review`, { method: 'POST', body: { decision, notes: notes || undefined } });
                  await refresh();
                }}
              />
            )}
            {['ACTIVE', 'OUT_OF_STOCK', 'SUSPENDED'].includes(p.status) && (
              <div className="flex flex-wrap gap-2 rounded-lg border p-3">
                <Input aria-label="Reason" placeholder="Reason (recorded in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} className="flex-1" />
                <Button
                  size="sm"
                  variant={p.status === 'SUSPENDED' ? 'default' : 'destructive'}
                  disabled={reason.trim().length < 3}
                  onClick={async () => {
                    setError(null);
                    try {
                      await api(`/admin/products/${selected}/${p.status === 'SUSPENDED' ? 'reinstate' : 'suspend'}`, { method: 'POST', body: { reason } });
                      setReason('');
                      await refresh();
                    } catch (err) {
                      setError(errorMessage(err));
                    }
                  }}
                >
                  {p.status === 'SUSPENDED' ? 'Reinstate' : 'Suspend'}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
