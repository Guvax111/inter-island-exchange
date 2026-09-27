'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { FormError } from '@/components/forms/field';
import { Markdown } from '@/components/help/markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { HELP_AUDIENCE_LABELS, type AdminHelpArticle } from '@/lib/types';

type Draft = Pick<AdminHelpArticle, 'slug' | 'title' | 'audience' | 'summary' | 'body' | 'sortOrder'>;
const EMPTY: Draft = { slug: '', title: '', audience: 'BUYER', summary: '', body: '', sortOrder: 100 };

export default function AdminHelpPage() {
  const { data } = useQuery({ queryKey: ['admin-help'], queryFn: () => api<{ items: AdminHelpArticle[] }>('/admin/help').then((r) => r.items) });
  const [editing, setEditing] = useState<AdminHelpArticle | 'new' | null>(null);
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Articles on the public Help Center. The first drafts were prepared for IIE to check: fix anything marked <strong>[IIE to confirm]</strong> before publishing. Only published articles are public.
        </p>
        <Button size="sm" onClick={() => setEditing('new')}>
          New article
        </Button>
        <ul className="divide-y rounded-lg border">
          {data?.map((a) => (
            <li key={a.id}>
              <button onClick={() => setEditing(a)} className={`w-full p-3 text-left hover:bg-muted ${editing !== 'new' && editing?.id === a.id ? 'bg-muted' : ''}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{a.title}</span>
                  <span className="flex gap-1">
                    {a.needsConfirmation && <Badge variant="outline">To confirm</Badge>}
                    <Badge variant={a.status === 'PUBLISHED' ? 'default' : 'secondary'}>{a.status === 'PUBLISHED' ? 'Published' : 'Draft'}</Badge>
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {HELP_AUDIENCE_LABELS[a.audience]} · /help/{a.slug}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {editing && <Editor key={editing === 'new' ? 'new' : editing.id} article={editing === 'new' ? null : editing} onSaved={(a) => setEditing(a)} />}
    </div>
  );
}

function Editor({ article, onSaved }: { article: AdminHelpArticle | null; onSaved: (a: AdminHelpArticle) => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(article ?? EMPTY);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  async function run(fn: () => Promise<AdminHelpArticle>) {
    setBusy(true);
    setError(null);
    try {
      const saved = await fn();
      await qc.invalidateQueries({ queryKey: ['admin-help'] });
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(() => (article ? api<AdminHelpArticle>(`/admin/help/${article.id}`, { method: 'PATCH', body: d }) : api<AdminHelpArticle>('/admin/help', { method: 'POST', body: d })));
  };

  return (
    <form onSubmit={save} className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="help-title">Title</Label>
          <Input id="help-title" value={d.title} onChange={(e) => set('title', e.target.value)} required minLength={3} maxLength={150} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="help-slug">Web address (/help/…)</Label>
          <Input id="help-slug" value={d.slug} onChange={(e) => set('slug', e.target.value)} required pattern="[a-z0-9-]+" maxLength={60} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="help-audience">For</Label>
          <select id="help-audience" value={d.audience} onChange={(e) => set('audience', e.target.value as Draft['audience'])} className="h-10 w-full rounded-md border px-3">
            {Object.entries(HELP_AUDIENCE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="help-order">Order in lists</Label>
          <Input id="help-order" type="number" min={0} max={1000} value={d.sortOrder} onChange={(e) => set('sortOrder', Number(e.target.value))} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="help-summary">Summary (shown in lists and search)</Label>
        <Input id="help-summary" value={d.summary} onChange={(e) => set('summary', e.target.value)} maxLength={300} />
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="help-body">Article</Label>
          <button type="button" className="text-xs underline" onClick={() => setPreview((p) => !p)}>
            {preview ? 'Edit' : 'Preview'}
          </button>
        </div>
        {preview ? (
          <div className="rounded-md border p-4">
            <Markdown source={d.body} />
          </div>
        ) : (
          <Textarea id="help-body" value={d.body} onChange={(e) => set('body', e.target.value)} required minLength={10} maxLength={30000} rows={18} className="font-mono text-xs" />
        )}
        <p className="text-xs text-muted-foreground">Formatting: ## Heading, ### Smaller heading, - list item, 1. numbered item, **bold**, [link text](/help/other-article).</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {article ? 'Save changes' : 'Create draft'}
        </Button>
        {article && article.status === 'DRAFT' && (
          <Button type="button" variant="outline" disabled={busy} onClick={() => run(() => api<AdminHelpArticle>(`/admin/help/${article.id}/publish`, { method: 'POST', body: {} }))}>
            Publish
          </Button>
        )}
        {article && article.status === 'PUBLISHED' && (
          <Button type="button" variant="outline" disabled={busy} onClick={() => run(() => api<AdminHelpArticle>(`/admin/help/${article.id}/unpublish`, { method: 'POST', body: {} }))}>
            Unpublish
          </Button>
        )}
      </div>
      {article?.needsConfirmation && <p className="text-xs text-coral-600">This article still contains “[IIE to confirm]”.</p>}
      <FormError message={error} />
    </form>
  );
}
