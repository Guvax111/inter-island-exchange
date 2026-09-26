'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { FormError } from '@/components/forms/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { apiForm, api, errorMessage } from '@/lib/api';
import { DOCUMENT_TYPE_LABELS, type SellerDocument } from '@/lib/types';

const STATUS: Record<SellerDocument['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  PENDING: { label: 'Waiting for IIE', variant: 'secondary' },
  ACCEPTED: { label: 'Accepted', variant: 'default' },
  REJECTED: { label: 'Not accepted', variant: 'destructive' },
};

/** Seller: upload proof of business registration or a national ID; IIE must accept one before approval. */
export function VerificationDocuments() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['my-documents'], queryFn: () => api<{ items: SellerDocument[] }>('/me/seller/documents').then((r) => r.items) });
  const [type, setType] = useState<SellerDocument['type']>('BUSINESS_REGISTRATION');
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accepted = data?.some((d) => d.status === 'ACCEPTED');

  async function upload(e: FormEvent) {
    e.preventDefault();
    const f = file.current?.files?.[0];
    if (!f) return setError('Choose a PDF or a photo of the document');
    const form = new FormData();
    form.append('type', type);
    form.append('file', f);
    setBusy(true);
    setError(null);
    try {
      await apiForm('/me/seller/documents', form);
      if (file.current) file.current.value = '';
      await qc.invalidateQueries({ queryKey: ['my-documents'] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Verification documents</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          To sell on IIE, upload <strong>proof of business registration</strong> (e.g. certificate of registration) or your <strong>national ID</strong>. Only you and IIE’s reviewers can see it.
          {accepted ? ' Your document has been accepted.' : ' IIE approves your application once a document is accepted.'}
        </p>
        {!!data?.length && (
          <ul className="divide-y rounded-lg border">
            {data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span>
                  {DOCUMENT_TYPE_LABELS[d.type]} · <a className="underline" href={d.url}>{d.fileName}</a>
                  {d.reviewNote && <span className="block text-xs text-muted-foreground">IIE: {d.reviewNote}</span>}
                </span>
                <Badge variant={STATUS[d.status].variant}>{STATUS[d.status].label}</Badge>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={upload} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="doc-type">Document</Label>
            <select id="doc-type" className="w-full rounded border p-2" value={type} onChange={(e) => setType(e.target.value as SellerDocument['type'])}>
              <option value="BUSINESS_REGISTRATION">{DOCUMENT_TYPE_LABELS.BUSINESS_REGISTRATION}</option>
              <option value="NATIONAL_ID">{DOCUMENT_TYPE_LABELS.NATIONAL_ID}</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="doc-file">File (PDF, JPEG or PNG, up to 10 MB)</Label>
            <input id="doc-file" ref={file} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="w-full text-sm" />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? 'Uploading…' : 'Upload'}
          </Button>
        </form>
        <FormError message={error} />
      </CardContent>
    </Card>
  );
}

/** IIE reviewer: the seller's documents with download links and accept / reject. */
export function DocumentsReview({ documents, onChange }: { documents: SellerDocument[]; onChange: () => Promise<unknown> }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function review(id: string, decision: 'ACCEPT' | 'REJECT') {
    setError(null);
    try {
      await api(`/admin/seller-documents/${id}/review`, { method: 'POST', body: { decision, note: note || undefined } });
      setNote('');
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <section className="space-y-2">
      <h3 className="font-semibold">Verification documents</h3>
      {!documents.length ? (
        <p className="text-muted-foreground">None uploaded yet. The seller must upload proof of business registration or a national ID before approval.</p>
      ) : (
        <>
          <ul className="divide-y rounded-lg border">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span>
                  {DOCUMENT_TYPE_LABELS[d.type]} · <a className="underline" href={d.url}>{d.fileName}</a> <span className="text-xs text-muted-foreground">({Math.ceil(d.bytes / 1024)} KB)</span>
                  {d.reviewNote && <span className="block text-xs text-muted-foreground">Note: {d.reviewNote}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <Badge variant={STATUS[d.status].variant}>{STATUS[d.status].label}</Badge>
                  {d.status !== 'ACCEPTED' && (
                    <Button size="sm" onClick={() => review(d.id, 'ACCEPT')} aria-label={`Accept ${d.fileName}`}>
                      Accept
                    </Button>
                  )}
                  {d.status !== 'REJECTED' && (
                    <Button size="sm" variant="outline" onClick={() => review(d.id, 'REJECT')} aria-label={`Reject ${d.fileName}`}>
                      Reject
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <input aria-label="Note to the seller (optional)" placeholder="Note to the seller (optional, e.g. why it was not accepted)" className="w-full rounded border p-2 text-sm" value={note} onChange={(e) => setNote(e.target.value)} />
        </>
      )}
      <FormError message={error} />
    </section>
  );
}
