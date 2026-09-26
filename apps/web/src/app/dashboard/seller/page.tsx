'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { StatusBadge } from '@/components/marketplace/status-badge';
import { Field, FormError } from '@/components/forms/field';
import { useMySeller, type MySeller } from '@/components/seller/use-seller';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiError, errorMessage } from '@/lib/api';

const STATUS_COPY: Record<string, string> = {
  PENDING_VERIFICATION: 'Confirm your email address so IIE can review your application.',
  UNDER_REVIEW: 'IIE is reviewing your application. We will email you when a decision is made.',
  DRAFT: 'IIE returned your application with a note. Update your details and resubmit.',
  APPROVED: 'Approved. IIE will contact you to set up payouts. Meanwhile, prepare your store and products; they go live when payouts are set up.',
  ACTIVE: 'Your store is live. Approved, in-stock products appear on the marketplace.',
  SUSPENDED: 'Your seller account is suspended and your products are hidden. Contact IIE support.',
  REJECTED: 'IIE could not approve your application.',
};

export default function SellerOverviewPage() {
  const { data, isLoading } = useMySeller();
  if (isLoading || !data) return <p className="text-muted-foreground">Loading…</p>;
  const { profile, storefront, productCounts } = data;
  const live = (productCounts.ACTIVE ?? 0) + (productCounts.OUT_OF_STOCK ?? 0);
  const steps = [
    { done: ['UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED'].includes(profile.status), label: 'Seller application submitted and reviewed' },
    { done: ['APPROVED', 'ACTIVE', 'SUSPENDED'].includes(profile.status), label: 'Application approved' },
    { done: !!storefront?.description, label: 'Store profile completed', href: '/dashboard/seller/store' },
    { done: Object.values(productCounts).some(Boolean), label: 'First product created', href: '/dashboard/seller/products/new' },
    { done: profile.payoutSetupConfirmed, label: 'Payouts set up with IIE' },
    { done: live > 0 && profile.status === 'ACTIVE', label: 'First product live on the marketplace' },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-lg border-l-4 border-ocean-600 bg-ocean-50 p-4" role="status">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{profile.legalName}</span>
          <StatusBadge status={profile.status} />
        </div>
        <p className="mt-1 text-sm">{STATUS_COPY[profile.status] ?? ''}</p>
        {profile.reviewNotes && <p className="mt-2 text-sm font-medium">Note from IIE: {profile.reviewNotes}</p>}
      </div>
      {profile.status === 'DRAFT' && profile.reviewNotes && <ResubmitForm profile={profile} />}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Getting started</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm">
              {steps.map((s) => (
                <li key={s.label} className="flex items-center gap-2">
                  {s.done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Done" /> : <Circle className="h-4 w-4 text-muted-foreground" aria-label="Not done" />}
                  {s.href && !s.done && ['APPROVED', 'ACTIVE'].includes(profile.status) ? <Link href={s.href} className="underline">{s.label}</Link> : s.label}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Products</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Live: {live}</p>
            <p>In review: {productCounts.PENDING_REVIEW ?? 0}</p>
            <p>Drafts: {productCounts.DRAFT ?? 0}</p>
            <div className="flex flex-wrap gap-2 pt-2">
              {['APPROVED', 'ACTIVE'].includes(profile.status) && (
                <Button asChild size="sm">
                  <Link href="/dashboard/seller/products/new">Add a product</Link>
                </Button>
              )}
              {storefront && profile.status === 'ACTIVE' && (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/seller/${storefront.slug}`}>View my store</Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ResubmitForm({ profile }: { profile: MySeller['profile'] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    legalName: profile.legalName,
    businessName: profile.businessName ?? '',
    registrationNumber: profile.registrationNumber ?? '',
    taxId: profile.taxId ?? '',
    phone: profile.phone,
    website: profile.website ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/me/seller/profile', { method: 'PATCH', body: form });
      await api('/me/seller/resubmit', { method: 'POST' });
      await qc.invalidateQueries({ queryKey: ['my-seller'] });
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorMessage(err));
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Update and resubmit</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FormError message={error} />
          </div>
          <Field id="legalName" label="Legal name" value={form.legalName} onChange={set('legalName')} error={errors.legalName} />
          <Field id="businessName" label="Trading name" value={form.businessName} onChange={set('businessName')} />
          <Field id="registrationNumber" label="Registration number" value={form.registrationNumber} onChange={set('registrationNumber')} />
          <Field id="taxId" label="Tax ID" value={form.taxId} onChange={set('taxId')} />
          <Field id="phone" label="Phone" value={form.phone} onChange={set('phone')} error={errors.phone} />
          <Field id="website" label="Website" value={form.website} onChange={set('website')} error={errors.website} />
          <Button type="submit" className="sm:col-span-2 sm:w-fit">
            Save and resubmit
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
