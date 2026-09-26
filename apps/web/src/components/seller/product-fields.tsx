'use client';

import { HsHelper } from '@/components/tariffs/hs-helper';
import { useQuery } from '@tanstack/react-query';
import { Field, SelectField } from '@/components/forms/field';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { flattenCategories, type CategoryNode } from '@/lib/types';

export interface ProductForm {
  title: string;
  shortDescription: string;
  description: string;
  categorySlug: string;
  brand: string;
  hsCode: string;
  countryOfOrigin: string;
  weightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
}

export const emptyProductForm = (countryOfOrigin: string): ProductForm => ({
  title: '',
  shortDescription: '',
  description: '',
  categorySlug: '',
  brand: '',
  hsCode: '',
  countryOfOrigin,
  weightKg: '',
  lengthCm: '',
  widthCm: '',
  heightCm: '',
});

const toInt = (value: string, factor: number) => (value.trim() ? Math.round(Number(value) * factor) : undefined);

/** Converts the form (kg, cm) into the API payload (grams, millimetres). */
export function toProductPayload(f: ProductForm) {
  return {
    title: f.title,
    shortDescription: f.shortDescription,
    description: f.description,
    categorySlug: f.categorySlug,
    brand: f.brand || undefined,
    hsCode: f.hsCode || undefined,
    countryOfOrigin: f.countryOfOrigin,
    weightGrams: toInt(f.weightKg, 1000),
    lengthMm: toInt(f.lengthCm, 10),
    widthMm: toInt(f.widthCm, 10),
    heightMm: toInt(f.heightCm, 10),
  };
}

export function ProductFields({ form, onChange, errors }: { form: ProductForm; onChange: (f: ProductForm) => void; errors: Record<string, string> }) {
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: () => api<{ items: CategoryNode[] }>('/categories').then((r) => flattenCategories(r.items)) });
  const { data: countries } = useQuery({ queryKey: ['countries-origins'], queryFn: () => api<{ items: { code: string; name: string }[] }>('/countries?scope=origins').then((r) => r.items) });
  const set = (k: keyof ProductForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...form, [k]: e.target.value });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field id="title" label="Product name" value={form.title} onChange={set('title')} error={errors.title} placeholder="e.g. Soft Care Baby Diapers Size 3 (56 pack)" />
      </div>
      <div className="sm:col-span-2">
        <Field id="shortDescription" label="Short description" value={form.shortDescription} onChange={set('shortDescription')} error={errors.shortDescription} hint="One sentence shown in search results." />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="description">Full description</Label>
        <Textarea id="description" rows={5} value={form.description} onChange={set('description')} />
        {errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
      </div>
      <SelectField
        id="categorySlug"
        label="Category"
        value={form.categorySlug}
        onChange={(v) => onChange({ ...form, categorySlug: v })}
        error={errors.categorySlug}
        options={[{ value: '', label: 'Choose a category' }, ...(categories ?? []).map((c) => ({ value: c.slug, label: c.label }))]}
      />
      <Field id="brand" label="Brand (optional)" value={form.brand} onChange={set('brand')} />
      <Field id="hsCode" label="HS code" value={form.hsCode} onChange={set('hsCode')} error={errors.hsCode} hint="Customs tariff code, e.g. 9619.00 for diapers. Ask your customs broker if unsure." />
      <HsHelper hsCode={form.hsCode} origin={form.countryOfOrigin} originName={countries?.find((c) => c.code === form.countryOfOrigin)?.name} />
      <SelectField
        id="countryOfOrigin"
        label="Country of origin"
        value={form.countryOfOrigin}
        onChange={(v) => onChange({ ...form, countryOfOrigin: v })}
        options={(countries ?? []).map((c) => ({ value: c.code, label: c.name }))}
      />
      <Field id="weightKg" label="Shipping weight (kg)" inputMode="decimal" value={form.weightKg} onChange={set('weightKg')} error={errors.weightGrams} />
      <div className="grid grid-cols-3 gap-2">
        <Field id="lengthCm" label="Length (cm)" inputMode="decimal" value={form.lengthCm} onChange={set('lengthCm')} error={errors.lengthMm} />
        <Field id="widthCm" label="Width (cm)" inputMode="decimal" value={form.widthCm} onChange={set('widthCm')} error={errors.widthMm} />
        <Field id="heightCm" label="Height (cm)" inputMode="decimal" value={form.heightCm} onChange={set('heightCm')} error={errors.heightMm} />
      </div>
    </div>
  );
}
