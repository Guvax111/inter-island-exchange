'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Field, FormError } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useRefreshMe } from '@/lib/session';
import { AuthCard } from './auth-card';

/** Only same-site relative paths are accepted as a post-login destination (no open redirects). */
function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/account';
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const refresh = useRefreshMe();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api('/auth/login', { method: 'POST', body: { email, password, totpCode: needsCode ? totpCode : undefined } });
      await refresh();
      router.push(safeNext(params.get('next')));
    } catch (err) {
      if (err instanceof ApiError && err.body.code === 'MFA_REQUIRED') {
        setNeedsCode(true);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Sign in" description="Welcome back to Inter-Island Exchange.">
      <form onSubmit={onSubmit} className="space-y-4">
        <FormError message={error} />
        <Field id="email" label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {needsCode && (
          <Field
            id="totpCode"
            label="6-digit code from your authenticator app"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
          />
        )}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
        <div className="flex justify-between text-sm">
          <Link href="/forgot-password" className="text-ocean-700 underline">
            Forgot password?
          </Link>
          <Link href="/signup" className="text-ocean-700 underline">
            Create an account
          </Link>
        </div>
      </form>
    </AuthCard>
  );
}
