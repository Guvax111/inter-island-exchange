'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH, registerSchema, type AccountType } from '@iie/shared';
import { Field, FormError, SelectField } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { api, ApiError, errorMessage } from '@/lib/api';
import { AuthCard } from './auth-card';

interface CountryOption {
  code: string;
  name: string;
  marketplaceEnabled: boolean;
}

const ACCOUNT_TYPES: { value: AccountType; label: string; help: string }[] = [
  { value: 'BUYER', label: 'Buyer', help: 'I want to buy products' },
  { value: 'SELLER', label: 'Seller', help: 'I want to sell products' },
  { value: 'BUYER_SELLER', label: 'Buyer + Seller', help: 'I want to do both' },
];

export function SignupForm() {
  const params = useSearchParams();
  const initialType = ACCOUNT_TYPES.some((t) => t.value === params.get('type')) ? (params.get('type') as AccountType) : 'BUYER';
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', countryCode: '', accountType: initialType });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const { data: countries } = useQuery({
    queryKey: ['countries'],
    queryFn: () => api<{ items: CountryOption[] }>('/countries').then((r) => r.items.filter((c) => c.marketplaceEnabled)),
  });

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = registerSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await api('/auth/register', { method: 'POST', body: parsed.data });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <AuthCard title="Check your email" description={`We sent a confirmation link to ${form.email}.`}>
        <p className="text-sm text-muted-foreground">
          Open the link to confirm your email address. You can sign in now and continue setting up your account while you wait.
        </p>
        <Button asChild className="mt-6 w-full">
          <Link href="/login">Sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Create your IIE account" description="It takes about a minute. You will finish your profile after signing in.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={formError} />
        <fieldset>
          <legend className="mb-2 text-sm font-medium">I am joining as a</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {ACCOUNT_TYPES.map((t) => (
              <label
                key={t.value}
                className={`cursor-pointer rounded-md border p-3 text-sm ${form.accountType === t.value ? 'border-ocean-700 bg-ocean-50' : ''}`}
              >
                <input
                  type="radio"
                  name="accountType"
                  value={t.value}
                  checked={form.accountType === t.value}
                  onChange={() => set('accountType')(t.value)}
                  className="sr-only"
                />
                <span className="block font-semibold">{t.label}</span>
                <span className="text-xs text-muted-foreground">{t.help}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="firstName" label="First name" autoComplete="given-name" value={form.firstName} onChange={(e) => set('firstName')(e.target.value)} error={errors.firstName} />
          <Field id="lastName" label="Last name" autoComplete="family-name" value={form.lastName} onChange={(e) => set('lastName')(e.target.value)} error={errors.lastName} />
        </div>
        <Field id="email" label="Email" type="email" autoComplete="email" value={form.email} onChange={(e) => set('email')(e.target.value)} error={errors.email} />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => set('password')(e.target.value)}
          error={errors.password}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short phrase is easiest to remember.`}
        />
        <SelectField
          id="countryCode"
          label="Country"
          value={form.countryCode}
          onChange={set('countryCode')}
          error={errors.countryCode}
          options={[{ value: '', label: 'Select your country' }, ...(countries ?? []).map((c) => ({ value: c.code, label: c.name }))]}
        />
        <p className="text-xs text-muted-foreground">
          IIE is open in {countries?.map((c) => c.name).join(' and ') || 'selected countries'} during the pilot. See{' '}
          <Link href="/countries" className="underline">
            all countries
          </Link>
          .
        </p>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-ocean-700 underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
