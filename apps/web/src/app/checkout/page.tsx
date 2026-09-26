'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Suspense, useEffect, useState } from 'react';
import { RequireSignIn } from '@/components/account/require-signin';
import { FormError } from '@/components/forms/field';
import { CostBreakdown } from '@/components/orders/cost-breakdown';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, errorMessage } from '@/lib/api';
import type { Quote } from '@/lib/types';

interface Address {
  id: string;
  label: string | null;
  line1: string;
  city: string;
  isDefault: boolean;
}

export default function CheckoutPage() {
  return (
    <section className="container max-w-4xl py-8">
      <h1 className="text-3xl font-bold text-ocean-900">Checkout</h1>
      <Suspense>
        <RequireSignIn>{() => <Checkout />}</RequireSignIn>
      </Suspense>
    </section>
  );
}

function Checkout() {
  const router = useRouter();
  const sellerSlug = useSearchParams().get('seller') ?? '';
  const { data: addresses } = useQuery({ queryKey: ['addresses'], queryFn: () => api<{ items: Address[] }>('/me/addresses').then((r) => r.items) });
  const [addressId, setAddressId] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    if (!addressId && addresses?.length) setAddressId((addresses.find((a) => a.isDefault) ?? addresses[0])!.id);
  }, [addresses, addressId]);

  useEffect(() => {
    if (!addressId || !sellerSlug) return;
    setError(null);
    setQuote(null);
    api<Quote>('/me/checkout/quote', { method: 'POST', body: { sellerSlug, addressId } })
      .then(setQuote)
      .catch((err) => setError(errorMessage(err)));
  }, [addressId, sellerSlug]);

  async function place() {
    if (!quote) return;
    setPlacing(true);
    setError(null);
    try {
      const { iieId } = await api<{ iieId: string }>('/me/checkout', { method: 'POST', body: { quoteId: quote.quoteId } });
      router.push(`/orders/${iieId}`);
    } catch (err) {
      setError(errorMessage(err));
      setPlacing(false);
    }
  }

  if (!sellerSlug) return <p className="mt-4 text-muted-foreground">Start checkout from your <Link href="/cart" className="underline">cart</Link>.</p>;

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Deliver to</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {addresses?.map((a) => (
              <label key={a.id} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${a.id === addressId ? 'border-ocean-700 bg-ocean-50' : ''}`}>
                <input type="radio" name="address" checked={a.id === addressId} onChange={() => setAddressId(a.id)} className="mt-1" />
                <span>
                  {a.label && <strong>{a.label}: </strong>}
                  {a.line1}, {a.city}
                </span>
              </label>
            ))}
            <Link href="/dashboard/buyer" className="text-sm text-ocean-700 underline">Add or change addresses</Link>
          </CardContent>
        </Card>
        {quote && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {quote.seller.name} · ships from {quote.shipsFrom} to {quote.shipsTo}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {quote.lines.map((l) => (
                  <li key={l.sku} className="flex justify-between gap-4 py-2">
                    <span>
                      {l.quantity} × {l.title} <span className="text-muted-foreground">({l.variantName})</span>
                    </span>
                    <span className="font-medium">{l.lineTotal.formatted}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                Parcel weight {quote.weightKg} kg · {quote.shipping.serviceName}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
      <div>
        <Card className="lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle className="text-lg">Order summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormError message={error} />
            {!quote && !error && <p className="text-sm text-muted-foreground">Calculating…</p>}
            {quote && (
              <>
                <CostBreakdown {...quote} />
                <Button className="w-full" size="lg" disabled={placing} onClick={place}>
                  {placing ? 'Placing order…' : `Place order · ${quote.total.formatted}`}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Placing the order reserves the items for 30 minutes. Online payment through IIE&apos;s licensed payment partner opens in the next release;
                  until then unpaid orders are cancelled automatically and you are not charged.
                </p>
                {error && (
                  <Link href="/cart" className="text-sm underline">
                    Back to cart
                  </Link>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
