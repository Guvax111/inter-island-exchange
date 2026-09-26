'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Field, FormError } from '@/components/forms/field';
import { useMySeller } from '@/components/seller/use-seller';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError, apiUpload, errorMessage } from '@/lib/api';

export default function StoreProfilePage() {
  const qc = useQueryClient();
  const { data } = useMySeller();
  const store = data?.storefront;
  const [form, setForm] = useState({ displayName: '', slug: '', description: '', shippingOrigin: '', returnPolicy: '', storePolicies: '', feePayer: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (store) setForm({ displayName: store.displayName, slug: store.slug, description: store.description, shippingOrigin: store.shippingOrigin, returnPolicy: store.returnPolicy, storePolicies: store.storePolicies, feePayer: store.feePayer ?? '' });
  }, [store]);

  if (!data) return <p className="text-muted-foreground">Loading…</p>;
  if (!store) return <p className="text-muted-foreground">Your store profile becomes available once IIE approves your seller application.</p>;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setSaved(false);
    setForm({ ...form, [k]: e.target.value });
  };
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/me/storefront', { method: 'PATCH', body: { ...form, feePayer: form.feePayer || null } });
      await qc.invalidateQueries({ queryKey: ['my-seller'] });
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorMessage(err));
    }
  }
  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      await apiUpload('/me/storefront/logo', file);
      await qc.invalidateQueries({ queryKey: ['my-seller'] });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const area = (k: 'description' | 'returnPolicy' | 'storePolicies', label: string, hint: string) => (
    <div className="space-y-1.5 sm:col-span-2">
      <Label htmlFor={k}>{label}</Label>
      <Textarea id={k} rows={4} value={form[k]} onChange={set(k)} />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <FormError message={error} />
        {saved && <p className="text-sm text-emerald-700" role="status">Saved.</p>}
      </div>
      <div className="flex items-center gap-4 sm:col-span-2">
        {store.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={store.logoUrl} alt="Store logo" className="h-20 w-20 rounded-full border object-cover" />
        ) : (
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground">No logo</span>
        )}
        <label className="cursor-pointer text-sm font-medium text-ocean-700 underline">
          Upload logo (JPEG, PNG or WebP)
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => uploadLogo(e.target.files?.[0])} />
        </label>
      </div>
      <Field id="displayName" label="Store name" value={form.displayName} onChange={set('displayName')} error={errors.displayName} />
      <Field id="slug" label="Store web address" value={form.slug} onChange={set('slug')} error={errors.slug} hint={`iie.example/seller/${form.slug || '…'}`} />
      <Field id="shippingOrigin" label="Ships from (town)" value={form.shippingOrigin} onChange={set('shippingOrigin')} placeholder="e.g. Castries" />
      <div />
      {area('description', 'About your store', 'Tell buyers who you are and what you sell.')}
      {area('returnPolicy', 'Return policy', 'For example: unopened items can be returned within 14 days of delivery.')}
      {area('storePolicies', 'Other store policies', 'Optional: packaging, bulk orders, business hours.')}
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="feePayer">Who pays the IIE platform fee (5% of product cost)?</Label>
        <select
          id="feePayer"
          value={form.feePayer}
          onChange={(e) => { setSaved(false); setForm({ ...form, feePayer: e.target.value }); }}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 md:w-96"
        >
          <option value="">IIE default (the buyer pays it at checkout)</option>
          <option value="BUYER">The buyer pays it at checkout</option>
          <option value="SELLER">I pay it: deduct it from my payout</option>
        </select>
        <p className="text-xs text-muted-foreground">Absorbing the fee makes your prices look lower at checkout.</p>
      </div>
      <Button type="submit" className="sm:w-fit">
        Save store profile
      </Button>
    </form>
  );
}
