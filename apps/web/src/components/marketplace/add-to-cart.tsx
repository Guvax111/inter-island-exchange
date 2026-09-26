'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Heart } from 'lucide-react';
import { FormError } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/session';
import type { PublicProduct } from '@/lib/types';

export function AddToCart({ product }: { product: PublicProduct }) {
  const { data: me, isLoading } = useMe();
  const pathname = usePathname();
  const [variantId, setVariantId] = useState(product.variants.find((v) => v.available > 0)?.id ?? product.variants[0]?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const variant = product.variants.find((v) => v.id === variantId);

  if (isLoading) return null;
  const isBuyer = me?.roles.includes('buyer');

  async function add() {
    setError(null);
    setMessage(null);
    try {
      await api('/me/cart/items', { method: 'POST', body: { variantId, quantity } });
      setMessage(`Added ${quantity} to your cart.`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function save() {
    try {
      await api(`/me/saved/products/${product.id}`, { method: saved ? 'DELETE' : 'PUT' });
      setSaved(!saved);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      {product.variants.length > 1 && (
        <label className="block text-sm font-medium">
          Option
          <select value={variantId} onChange={(e) => setVariantId(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-white px-3">
            {product.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} — {v.price.formatted} {v.available ? '' : '(out of stock)'}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-2xl font-bold text-ocean-900">
        {variant?.price.formatted} <span className="text-sm font-normal text-muted-foreground">{variant?.price.currency}</span>
      </p>
      <p className="text-sm">{variant && variant.available > 0 ? `${variant.available} available` : 'Out of stock'}</p>
      {!me ? (
        <Button asChild className="w-full">
          <Link href={`/login?next=${encodeURIComponent(pathname)}`}>Sign in to buy</Link>
        </Button>
      ) : !isBuyer ? (
        <p className="text-sm text-muted-foreground">Buying needs a buyer account. This account is set up for selling only.</p>
      ) : me.user.status !== 'ACTIVE' ? (
        <p className="text-sm text-muted-foreground">
          Finish setting up your account to buy. <Link href="/account" className="underline">Go to my account</Link>
        </p>
      ) : (
        <>
          <FormError message={error} />
          {message && (
            <p className="text-sm text-emerald-700" role="status">
              {message} <Link href="/cart" className="underline">View cart</Link>
            </p>
          )}
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="qty">Quantity</label>
            <input
              id="qty"
              type="number"
              min={1}
              max={Math.max(1, Math.min(99, variant?.available ?? 1))}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
              className="h-10 w-20 rounded-md border px-2"
            />
            <Button className="flex-1" disabled={!variant || variant.available < 1} onClick={add}>
              Add to cart
            </Button>
            <Button variant="outline" size="icon" onClick={save} aria-label={saved ? 'Remove from saved' : 'Save for later'} aria-pressed={saved}>
              <Heart className={saved ? 'fill-coral-500 text-coral-500' : ''} />
            </Button>
          </div>
        </>
      )}
      <p className="text-xs text-muted-foreground">Shipping, duties and taxes, and IIE fees are shown at checkout before you pay.</p>
    </div>
  );
}
