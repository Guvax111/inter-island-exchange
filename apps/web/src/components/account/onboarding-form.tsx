'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { buyerOnboardingSchema, sellerOnboardingSchema } from '@iie/shared';
import { z } from 'zod';
import { Field, FormError, SelectField } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useRefreshMe, type Me } from '@/lib/session';

const CATEGORIES = ['Baby & Child', 'Food & Beverage', 'Health & Beauty', 'Household', 'Clothing & Accessories', 'Arts & Crafts', 'Electronics', 'Agriculture', 'Other'];

type Address = { line1: string; line2: string; city: string; region: string; postalCode: string };
const emptyAddress: Address = { line1: '', line2: '', city: '', region: '', postalCode: '' };

function AddressFields({ prefix, value, onChange, errors }: { prefix: string; value: Address; onChange: (a: Address) => void; errors: Record<string, string> }) {
  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field id={`${prefix}.address.line1`} label="Street address" autoComplete="address-line1" value={value.line1} onChange={set('line1')} error={errors[`${prefix}.address.line1`]} />
      </div>
      <div className="sm:col-span-2">
        <Field id={`${prefix}.address.line2`} label="Address line 2 (optional)" autoComplete="address-line2" value={value.line2} onChange={set('line2')} />
      </div>
      <Field id={`${prefix}.address.city`} label="Town / city" autoComplete="address-level2" value={value.city} onChange={set('city')} error={errors[`${prefix}.address.city`]} />
      <Field id={`${prefix}.address.region`} label="Quarter / parish (optional)" value={value.region} onChange={set('region')} />
      <Field id={`${prefix}.address.postalCode`} label="Postal code (optional)" autoComplete="postal-code" value={value.postalCode} onChange={set('postalCode')} />
    </div>
  );
}

export function OnboardingForm({ me }: { me: Me }) {
  const router = useRouter();
  const refresh = useRefreshMe();
  const isBuyer = me.roles.includes('buyer');
  const isSeller = me.roles.includes('seller');
  const countryCode = me.user.country.code;

  const [buyer, setBuyer] = useState({ firstName: me.user.firstName, lastName: me.user.lastName, phone: '', partyType: 'INDIVIDUAL', businessName: '' });
  const [buyerAddress, setBuyerAddress] = useState<Address>(emptyAddress);
  const [seller, setSeller] = useState({ partyType: 'BUSINESS', legalName: '', businessName: '', registrationNumber: '', taxId: '', phone: '', website: '', category: CATEGORIES[0]! });
  const [sellerAddress, setSellerAddress] = useState<Address>(emptyAddress);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const body = {
      buyer: isBuyer ? { ...buyer, address: { ...buyerAddress, countryCode } } : undefined,
      seller: isSeller ? { ...seller, address: { ...sellerAddress, countryCode } } : undefined,
    };
    const schema = z.object({ buyer: buyerOnboardingSchema.optional(), seller: sellerOnboardingSchema.optional() });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      setFormError('Please check the highlighted fields.');
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await api('/me/onboarding', { method: 'POST', body: parsed.data });
      await refresh();
      router.push('/account');
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <FormError message={formError} />
      {isBuyer && (
        <Card>
          <CardHeader>
            <CardTitle>Buyer details</CardTitle>
            <CardDescription>Where should sellers deliver your orders in {me.user.country.name}?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="buyer.firstName" label="First name" value={buyer.firstName} onChange={(e) => setBuyer({ ...buyer, firstName: e.target.value })} error={errors['buyer.firstName']} />
              <Field id="buyer.lastName" label="Last name" value={buyer.lastName} onChange={(e) => setBuyer({ ...buyer, lastName: e.target.value })} error={errors['buyer.lastName']} />
            </div>
            <Field id="buyer.phone" label="Mobile phone" type="tel" autoComplete="tel" placeholder="+1784…" value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} error={errors['buyer.phone']} hint="Include your country code, e.g. +1 784 for St. Vincent." />
            <SelectField id="buyer.partyType" label="Buying as" value={buyer.partyType} onChange={(v) => setBuyer({ ...buyer, partyType: v })} options={[{ value: 'INDIVIDUAL', label: 'An individual' }, { value: 'BUSINESS', label: 'A business' }]} />
            {buyer.partyType === 'BUSINESS' && (
              <Field id="buyer.businessName" label="Business name" value={buyer.businessName} onChange={(e) => setBuyer({ ...buyer, businessName: e.target.value })} error={errors['buyer.businessName']} />
            )}
            <AddressFields prefix="buyer" value={buyerAddress} onChange={setBuyerAddress} errors={errors} />
          </CardContent>
        </Card>
      )}
      {isSeller && (
        <Card>
          <CardHeader>
            <CardTitle>Seller details</CardTitle>
            <CardDescription>IIE reviews every seller before they can list products. This information is kept private.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SelectField id="seller.partyType" label="Selling as" value={seller.partyType} onChange={(v) => setSeller({ ...seller, partyType: v })} options={[{ value: 'BUSINESS', label: 'A registered business' }, { value: 'INDIVIDUAL', label: 'An individual' }]} />
            <Field id="seller.legalName" label={seller.partyType === 'BUSINESS' ? 'Registered legal name of the business' : 'Your full legal name'} value={seller.legalName} onChange={(e) => setSeller({ ...seller, legalName: e.target.value })} error={errors['seller.legalName']} />
            {seller.partyType === 'BUSINESS' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="seller.businessName" label="Trading name" value={seller.businessName} onChange={(e) => setSeller({ ...seller, businessName: e.target.value })} error={errors['seller.businessName']} />
                <Field id="seller.registrationNumber" label="Business registration number" value={seller.registrationNumber} onChange={(e) => setSeller({ ...seller, registrationNumber: e.target.value })} error={errors['seller.registrationNumber']} />
              </div>
            )}
            <Field id="seller.taxId" label="Tax ID (optional)" value={seller.taxId} onChange={(e) => setSeller({ ...seller, taxId: e.target.value })} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="seller.phone" label="Business phone" type="tel" placeholder="+1758…" value={seller.phone} onChange={(e) => setSeller({ ...seller, phone: e.target.value })} error={errors['seller.phone']} />
              <Field id="seller.website" label="Website (optional)" type="url" placeholder="https://" value={seller.website} onChange={(e) => setSeller({ ...seller, website: e.target.value })} error={errors['seller.website']} />
            </div>
            <SelectField id="seller.category" label="Main product category" value={seller.category} onChange={(v) => setSeller({ ...seller, category: v })} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
            <AddressFields prefix="seller" value={sellerAddress} onChange={setSellerAddress} errors={errors} />
          </CardContent>
        </Card>
      )}
      <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={submitting}>
        {submitting ? 'Submitting…' : 'Submit'}
      </Button>
    </form>
  );
}
