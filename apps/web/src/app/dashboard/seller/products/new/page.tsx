'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Field, FormError } from '@/components/forms/field';
import { emptyProductForm, ProductFields, toProductPayload } from '@/components/seller/product-fields';
import { Button } from '@/components/ui/button';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/session';
import type { SellerProduct } from '@/lib/types';

export default function NewProductPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const [form, setForm] = useState(() => emptyProductForm(me?.user.country.code ?? 'LC'));
  const [variant, setVariant] = useState({ sku: '', name: '', price: '', quantity: '0' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const created = await api<SellerProduct>('/me/products', {
        method: 'POST',
        body: { ...toProductPayload(form), variants: [{ ...variant, quantity: Number(variant.quantity) || 0 }] },
      });
      router.push(`/dashboard/seller/products/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  const v = (k: keyof typeof variant) => (e: React.ChangeEvent<HTMLInputElement>) => setVariant({ ...variant, [k]: e.target.value });
  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <h2 className="text-xl font-semibold">New product</h2>
      <FormError message={error} />
      <ProductFields form={form} onChange={setForm} errors={errors} />
      <fieldset className="rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Price and stock</legend>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field id="sku" label="SKU" value={variant.sku} onChange={v('sku')} error={errors['variants.0.sku']} hint="Your own stock code" />
          <Field id="variantName" label="Option name" value={variant.name} onChange={v('name')} error={errors['variants.0.name']} placeholder="e.g. 56 pack" />
          <Field id="price" label={`Price (${me?.user.country.currency.code ?? ''})`} inputMode="decimal" value={variant.price} onChange={v('price')} error={errors['variants.0.price']} placeholder="45.00" />
          <Field id="quantity" label="Quantity in stock" type="number" min={0} value={variant.quantity} onChange={v('quantity')} />
        </div>
      </fieldset>
      <p className="text-sm text-muted-foreground">Next you can add photos and more options, then submit the product for IIE review.</p>
      <Button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save draft'}
      </Button>
    </form>
  );
}
