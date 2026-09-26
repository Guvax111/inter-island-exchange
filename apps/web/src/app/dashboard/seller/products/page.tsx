'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ImageOff } from 'lucide-react';
import { StatusBadge } from '@/components/marketplace/status-badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { SellerProduct } from '@/lib/types';

export default function SellerProductsPage() {
  const { data, isLoading } = useQuery({ queryKey: ['my-products'], queryFn: () => api<{ items: SellerProduct[] }>('/me/products') });
  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  const items = data?.items ?? [];
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button asChild>
          <Link href="/dashboard/seller/products/new">Add a product</Link>
        </Button>
      </div>
      {!items.length ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">No products yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {items.map((p) => {
            const stock = p.variants.reduce((n, v) => n + v.quantityOnHand, 0);
            return (
              <li key={p.id}>
                <Link href={`/dashboard/seller/products/${p.id}`} className="flex items-center gap-3 p-3 hover:bg-muted/50">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                    {p.images[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.images[0].url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <ImageOff className="h-5 w-5 text-muted-foreground" aria-hidden />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {p.variants[0]?.price.formatted} · {stock} in stock
                    </p>
                  </div>
                  <StatusBadge status={p.status} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
