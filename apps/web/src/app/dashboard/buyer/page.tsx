'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { RequireSignIn } from '@/components/account/require-signin';
import { NextActionBanner } from '@/components/account/next-action';
import { Field, FormError } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiError, errorMessage } from '@/lib/api';
import type { Me } from '@/lib/session';
import type { Cart, Money, SellerCard } from '@/lib/types';

interface SavedProduct {
  id: string;
  title: string;
  imageUrl: string | null;
  priceFrom: Money | null;
  available: boolean;
}
interface Address {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  countryCode: string;
  isDefault: boolean;
}

export default function BuyerDashboardPage() {
  return (
    <section className="container max-w-5xl space-y-6 py-8">
      <h1 className="text-2xl font-bold text-ocean-900">Buyer dashboard</h1>
      <RequireSignIn>{(me) => (me.roles.includes('buyer') ? <BuyerDashboard me={me} /> : <p className="text-muted-foreground">This dashboard is for buyer accounts.</p>)}</RequireSignIn>
    </section>
  );
}

function BuyerDashboard({ me }: { me: Me }) {
  const qc = useQueryClient();
  const cart = useQuery({ queryKey: ['cart'], queryFn: () => api<Cart>('/me/cart') });
  const products = useQuery({ queryKey: ['saved-products'], queryFn: () => api<{ items: SavedProduct[] }>('/me/saved/products') });
  const sellers = useQuery({ queryKey: ['saved-sellers'], queryFn: () => api<{ items: (SellerCard & { available: boolean })[] }>('/me/saved/sellers') });
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: () => api<{ items: Address[] }>('/me/addresses') });

  return (
    <div className="space-y-6">
      <NextActionBanner me={me} />
      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Cart</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{cart.data?.itemCount ?? 0} items</p>
            <Button asChild size="sm">
              <Link href="/cart">View cart</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Orders</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Orders, payments, tracking and disputes appear here once checkout opens.</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Shop</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild size="sm" variant="outline">
              <Link href={`/marketplace?destination=${me.user.country.code}`}>Products that ship to {me.user.country.name}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Saved products</CardTitle>
        </CardHeader>
        <CardContent>
          {!products.data?.items.length ? (
            <p className="text-sm text-muted-foreground">Tap the heart on a product to save it here.</p>
          ) : (
            <ul className="divide-y">
              {products.data.items.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  {p.available ? <Link href={`/products/${p.id}`} className="underline">{p.title}</Link> : <span className="text-muted-foreground">{p.title} (no longer available)</span>}
                  <span className="flex items-center gap-2">
                    {p.priceFrom?.formatted}
                    <Button size="sm" variant="ghost" onClick={async () => { await api(`/me/saved/products/${p.id}`, { method: 'DELETE' }); await qc.invalidateQueries({ queryKey: ['saved-products'] }); }}>
                      Remove
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Saved sellers</CardTitle>
        </CardHeader>
        <CardContent>
          {!sellers.data?.items.length ? (
            <p className="text-sm text-muted-foreground">Save sellers from their store page.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {sellers.data.items.map((s) => (
                <li key={s.slug}>{s.available ? <Link href={`/seller/${s.slug}`} className="underline">{s.name}</Link> : <span className="text-muted-foreground">{s.slug} (no longer available)</span>}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Addresses me={me} items={addresses.data?.items ?? []} />
    </div>
  );
}

function Addresses({ me, items }: { me: Me; items: Address[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ label: '', line1: '', line2: '', city: '', region: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['addresses'] });
  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorMessage(err));
    }
  }
  async function add(e: FormEvent) {
    e.preventDefault();
    await act(() => api('/me/addresses', { method: 'POST', body: { ...form, countryCode: me.user.country.code } }));
    setOpen(false);
  }
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Delivery addresses in {me.user.country.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <FormError message={error} />
        <ul className="divide-y">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                {a.label && <strong>{a.label}: </strong>}
                {[a.line1, a.line2, a.city, a.region].filter(Boolean).join(', ')}
                {a.isDefault && <span className="ml-2 text-xs font-semibold text-emerald-700">Default</span>}
              </span>
              {!a.isDefault && (
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => act(() => api(`/me/addresses/${a.id}/default`, { method: 'POST' }))}>Make default</Button>
                  <Button size="sm" variant="ghost" onClick={() => act(() => api(`/me/addresses/${a.id}`, { method: 'DELETE' }))}>Delete</Button>
                </span>
              )}
            </li>
          ))}
        </ul>
        {open ? (
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-2">
            <Field id="addr-label" label="Label (optional)" value={form.label} onChange={set('label')} placeholder="Home, Work…" />
            <Field id="addr-line1" label="Street address" value={form.line1} onChange={set('line1')} error={errors.line1} />
            <Field id="addr-line2" label="Address line 2 (optional)" value={form.line2} onChange={set('line2')} />
            <Field id="addr-city" label="Town / city" value={form.city} onChange={set('city')} error={errors.city} />
            <Field id="addr-region" label="Parish (optional)" value={form.region} onChange={set('region')} />
            <div className="flex items-end gap-2">
              <Button type="submit" size="sm">Save address</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </form>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Add an address</Button>
        )}
      </CardContent>
    </Card>
  );
}
