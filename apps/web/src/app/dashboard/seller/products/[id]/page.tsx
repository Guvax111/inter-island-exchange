'use client';

import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { StatusBadge } from '@/components/marketplace/status-badge';
import { Field, FormError } from '@/components/forms/field';
import { ProductFields, toProductPayload, type ProductForm } from '@/components/seller/product-fields';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiError, apiUpload, errorMessage } from '@/lib/api';
import type { SellerProduct } from '@/lib/types';

const LIVE = ['ACTIVE', 'OUT_OF_STOCK'];
const STATUS_HELP: Record<string, string> = {
  DRAFT: 'Draft. Add photos and details, then submit it for review.',
  PENDING_REVIEW: 'IIE is reviewing this product. You will get an email when it is decided.',
  ACTIVE: 'Live on the marketplace.',
  OUT_OF_STOCK: 'Approved but out of stock. Update the stock to sell it again.',
  REJECTED: 'Not approved. Editing it returns it to draft so you can fix and resubmit.',
  SUSPENDED: 'Suspended by IIE and hidden from buyers. Contact support.',
  ARCHIVED: 'Archived and hidden. Restore it to edit.',
};

function toForm(p: SellerProduct): ProductForm {
  const cm = (mm: number | null) => (mm ? String(mm / 10) : '');
  return {
    title: p.title,
    shortDescription: p.shortDescription,
    description: p.description,
    categorySlug: p.category?.slug ?? '',
    brand: p.brand ?? '',
    hsCode: p.hsCode ?? '',
    countryOfOrigin: p.countryOfOrigin?.code ?? 'LC',
    weightKg: p.weightGrams ? String(p.weightGrams / 1000) : '',
    lengthCm: cm(p.lengthMm),
    widthCm: cm(p.widthMm),
    heightCm: cm(p.heightMm),
  };
}

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: product, isLoading } = useQuery({ queryKey: ['my-product', id], queryFn: () => api<SellerProduct>(`/me/products/${id}`) });
  const [form, setForm] = useState<ProductForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (product) setForm(toForm(product));
  }, [product]);

  if (isLoading || !product || !form) return <p className="text-muted-foreground">Loading…</p>;
  const locked = ['ARCHIVED', 'SUSPENDED'].includes(product.status);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setError(null);
    setNotice(null);
    try {
      const updated = (await fn()) as SellerProduct | undefined;
      if (updated?.id) qc.setQueryData(['my-product', id], updated);
      else await qc.invalidateQueries({ queryKey: ['my-product', id] });
      await qc.invalidateQueries({ queryKey: ['my-products'] });
      if (done) setNotice(done);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorMessage(err));
    }
  }

  function saveDetails(e: FormEvent) {
    e.preventDefault();
    if (LIVE.includes(product!.status) && !confirm('Changing the name, descriptions, category, brand, HS code or origin sends this product back to IIE review and hides it until approved. Continue?')) return;
    run(() => api(`/me/products/${id}`, { method: 'PATCH', body: toProductPayload(form!) }), 'Saved.');
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border-l-4 border-ocean-600 bg-ocean-50 p-4" role="status">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{product.title}</h2>
          <StatusBadge status={product.status} />
        </div>
        <p className="mt-1 text-sm">{STATUS_HELP[product.status]}</p>
        {product.reviewNotes && ['DRAFT', 'REJECTED'].includes(product.status) && <p className="mt-1 text-sm font-medium">Note from IIE: {product.reviewNotes}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {['DRAFT', 'REJECTED'].includes(product.status) && (
            <Button size="sm" onClick={() => run(() => api(`/me/products/${id}/submit`, { method: 'POST' }), 'Submitted for review.')}>
              Submit for review
            </Button>
          )}
          {product.status === 'ARCHIVED' ? (
            <Button size="sm" variant="outline" onClick={() => run(() => api(`/me/products/${id}/restore`, { method: 'POST' }))}>
              Restore
            </Button>
          ) : (
            product.status !== 'SUSPENDED' && (
              <Button size="sm" variant="ghost" onClick={() => confirm('Archive this product? It will be hidden from buyers.') && run(() => api(`/me/products/${id}/archive`, { method: 'POST' }))}>
                Archive
              </Button>
            )
          )}
        </div>
      </div>
      <FormError message={error} />
      {notice && <p className="text-sm text-emerald-700" role="status">{notice}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Photos</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {product.images.map((img) => (
              <li key={img.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.altText} className="aspect-square w-full rounded-md border object-cover" />
                {!locked && (
                  <button
                    type="button"
                    className="absolute right-1 top-1 rounded bg-white/90 p-1"
                    aria-label="Remove photo"
                    onClick={() => run(() => api(`/me/products/${id}/images/${img.id}/delete`, { method: 'POST' }))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!locked && product.images.length < 8 && (
            <label className="mt-3 inline-block cursor-pointer text-sm font-medium text-ocean-700 underline">
              Add a photo (JPEG, PNG or WebP)
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) run(() => apiUpload(`/me/products/${id}/images`, file, { altText: product.title }), LIVE.includes(product.status) ? 'Photo added. The product is back in review.' : 'Photo added.');
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Options, prices and stock</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {product.variants.map((v) => (
            <VariantRow key={v.id} productId={id} variant={v} disabled={locked} run={run} />
          ))}
          {!locked && <AddVariant productId={id} run={run} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveDetails} className="space-y-4">
            <fieldset disabled={locked}>
              <ProductFields form={form} onChange={setForm} errors={errors} />
            </fieldset>
            {!locked && <Button type="submit">Save details</Button>}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function VariantRow({ productId, variant, disabled, run }: { productId: string; variant: SellerProduct['variants'][number]; disabled: boolean; run: (fn: () => Promise<unknown>, done?: string) => void }) {
  // All configured currencies have 2 minor units.
  const [price, setPrice] = useState((Number(variant.price.amountMinor) / 100).toFixed(2));
  const [qty, setQty] = useState(String(variant.quantityOnHand));
  return (
    <div className="grid items-end gap-2 rounded-md border p-3 sm:grid-cols-[1fr_120px_auto_120px_auto]">
      <div>
        <p className="font-medium">{variant.name}</p>
        <p className="text-xs text-muted-foreground">SKU {variant.sku}</p>
      </div>
      <Field id={`price-${variant.id}`} label={`Price (${variant.price.currency})`} inputMode="decimal" value={price} disabled={disabled} onChange={(e) => setPrice(e.target.value)} />
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => run(() => api(`/me/products/${productId}/variants/${variant.id}`, { method: 'PATCH', body: { price } }), 'Price updated.')}>
        Update price
      </Button>
      <Field id={`qty-${variant.id}`} label="In stock" type="number" min={0} value={qty} disabled={disabled} onChange={(e) => setQty(e.target.value)} />
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => run(() => api(`/me/products/${productId}/variants/${variant.id}/stock`, { method: 'PUT', body: { quantity: Number(qty) || 0 } }), 'Stock updated.')}>
        Update stock
      </Button>
    </div>
  );
}

function AddVariant({ productId, run }: { productId: string; run: (fn: () => Promise<unknown>, done?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ sku: '', name: '', price: '', quantity: '0' });
  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>+ Add another option (size, pack…)</Button>;
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <div className="grid items-end gap-2 rounded-md border border-dashed p-3 sm:grid-cols-5">
      <Field id="new-sku" label="SKU" value={v.sku} onChange={set('sku')} />
      <Field id="new-name" label="Option name" value={v.name} onChange={set('name')} />
      <Field id="new-price" label="Price" inputMode="decimal" value={v.price} onChange={set('price')} />
      <Field id="new-qty" label="In stock" type="number" min={0} value={v.quantity} onChange={set('quantity')} />
      <Button size="sm" onClick={() => run(() => api(`/me/products/${productId}/variants`, { method: 'POST', body: { ...v, quantity: Number(v.quantity) || 0 } }), 'Option added.')}>
        Add option
      </Button>
    </div>
  );
}
