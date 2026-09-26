'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Field, FormError, SelectField } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { api, ApiError, errorMessage } from '@/lib/api';
import { flattenCategories, type CategoryNode } from '@/lib/types';

export default function AdminCategoriesPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin-categories'], queryFn: () => api<{ items: CategoryNode[] }>('/admin/categories').then((r) => r.items) });
  const [form, setForm] = useState({ name: '', slug: '', parentSlug: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-categories'] });

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/admin/categories', { method: 'POST', body: { ...form, parentSlug: form.parentSlug || undefined } });
      setForm({ name: '', slug: '', parentSlug: '' });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorMessage(err));
    }
  }
  async function toggle(node: CategoryNode) {
    try {
      await api(`/admin/categories/${node.slug}`, { method: 'PATCH', body: { active: !node.active } });
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  const render = (nodes: CategoryNode[], depth = 0): React.ReactNode =>
    nodes.map((n) => (
      <li key={n.id}>
        <div className="flex items-center justify-between py-1.5 text-sm" style={{ paddingLeft: depth * 20 }}>
          <span className={n.active ? '' : 'text-muted-foreground line-through'}>
            {n.name} <span className="text-xs text-muted-foreground">/{n.slug}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => toggle(n)}>{n.active ? 'Hide' : 'Show'}</Button>
        </div>
        {n.children.length > 0 && <ul>{render(n.children, depth + 1)}</ul>}
      </li>
    ));

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <ul className="divide-y rounded-lg border p-3">{render(data ?? [])}</ul>
      <form onSubmit={create} className="space-y-3 rounded-lg border p-4">
        <h2 className="font-semibold">Add a category</h2>
        <FormError message={error} />
        <Field id="cat-name" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slug || '' })} error={errors.name} />
        <Field id="cat-slug" label="Web address" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} error={errors.slug} hint="Lowercase with hyphens, e.g. baby-clothing" />
        <SelectField id="cat-parent" label="Parent" value={form.parentSlug} onChange={(v) => setForm({ ...form, parentSlug: v })} options={[{ value: '', label: 'None (top level)' }, ...flattenCategories(data ?? []).map((c) => ({ value: c.slug, label: c.label }))]} />
        <Button type="submit" size="sm">Add category</Button>
      </form>
    </div>
  );
}
