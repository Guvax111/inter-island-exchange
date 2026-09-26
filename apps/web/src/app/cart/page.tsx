'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ImageOff, Trash2 } from 'lucide-react';
import { RequireSignIn } from '@/components/account/require-signin';
import { FormError } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/api';
import type { Cart, LineIssue } from '@/lib/types';

const ISSUE_TEXT: Record<LineIssue, string> = {
  UNAVAILABLE: 'No longer available. Remove it to continue.',
  NOT_SHIPPABLE_TO_YOU: 'This seller does not ship to your country.',
  INSUFFICIENT_STOCK: 'Not enough stock for this quantity.',
};

export default function CartPage() {
  return (
    <section className="container max-w-4xl py-8">
      <h1 className="text-3xl font-bold text-ocean-900">Your cart</h1>
      <RequireSignIn>{(me) => (me.roles.includes('buyer') ? <CartView /> : <p className="mt-4 text-muted-foreground">Carts are for buyer accounts.</p>)}</RequireSignIn>
    </section>
  );
}

function CartView() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { data: cart, isLoading } = useQuery({ queryKey: ['cart'], queryFn: () => api<Cart>('/me/cart') });

  async function run(fn: () => Promise<Cart>) {
    setError(null);
    try {
      qc.setQueryData(['cart'], await fn());
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  const setQty = (variantId: string, quantity: number) => run(() => api<Cart>(`/me/cart/items/${variantId}`, { method: 'PATCH', body: { quantity } }));
  const remove = (variantId: string) => run(() => api<Cart>(`/me/cart/items/${variantId}`, { method: 'DELETE' }));

  if (isLoading || !cart) return <p className="mt-4 text-muted-foreground">Loading…</p>;
  if (!cart.sellers.length) {
    return (
      <div className="mt-8 rounded-lg border border-dashed p-8 text-center">
        <p className="text-muted-foreground">Your cart is empty.</p>
        <Button asChild className="mt-4">
          <Link href="/marketplace">Shop the marketplace</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      <FormError message={error} />
      {cart.sellers.map((group) => (
        <div key={group.seller.slug ?? group.seller.name} className="rounded-lg border">
          <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-3">
            <p className="font-semibold">
              {group.seller.slug ? <Link href={`/seller/${group.seller.slug}`} className="underline">{group.seller.name}</Link> : group.seller.name}
              <span className="ml-2 text-sm font-normal text-muted-foreground">ships from {group.seller.countryName}</span>
            </p>
          </div>
          <ul className="divide-y">
            {group.lines.map((line) => (
              <li key={line.variantId} className="flex gap-3 p-4">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                  {line.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={line.imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImageOff className="h-6 w-6 text-muted-foreground" aria-hidden />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={`/products/${line.productId}`} className="font-medium underline-offset-2 hover:underline">
                    {line.title}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {line.variantName} · {line.unitPrice.formatted} each
                  </p>
                  {line.issues.map((i) => (
                    <p key={i} className="text-sm font-medium text-destructive">
                      {ISSUE_TEXT[i]} {i === 'INSUFFICIENT_STOCK' && line.available > 0 && `(${line.available} available)`}
                    </p>
                  ))}
                  <div className="mt-2 flex items-center gap-2">
                    <label className="sr-only" htmlFor={`qty-${line.variantId}`}>Quantity</label>
                    <select
                      id={`qty-${line.variantId}`}
                      value={line.quantity}
                      onChange={(e) => setQty(line.variantId, Number(e.target.value))}
                      className="h-9 rounded-md border bg-white px-2"
                    >
                      {Array.from({ length: Math.max(line.quantity, Math.min(20, line.available)) }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                    <Button variant="ghost" size="sm" onClick={() => remove(line.variantId)} aria-label={`Remove ${line.title}`}>
                      <Trash2 className="h-4 w-4" aria-hidden /> Remove
                    </Button>
                  </div>
                </div>
                <p className="font-semibold">{line.lineTotal.formatted}</p>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p>
              Product subtotal: <span className="font-semibold">{group.subtotal.formatted}</span>
            </p>
            {group.readyForCheckout && group.seller.slug ? (
              <Button asChild>
                <Link href={`/checkout?seller=${group.seller.slug}`}>Check out with {group.seller.name}</Link>
              </Button>
            ) : (
              <Button disabled title="Fix the items marked above first">
                Check out
              </Button>
            )}
          </div>
        </div>
      ))}
      <ul className="space-y-1 text-sm text-muted-foreground">
        {cart.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}
