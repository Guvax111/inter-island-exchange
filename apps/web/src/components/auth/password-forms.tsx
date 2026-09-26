'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH, passwordSchema } from '@iie/shared';
import { Field, FormError } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/api';
import { AuthCard } from './auth-card';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api('/auth/password/forgot', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthCard title="Check your email" description="If an account exists for that address, we have sent a link to reset your password. It expires in 1 hour.">
        <Button asChild className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Reset your password" description="Enter your email and we will send you a reset link.">
      <form onSubmit={onSubmit} className="space-y-4">
        <FormError message={error} />
        <Field id="email" label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
    </AuthCard>
  );
}

export function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = passwordSchema.safeParse(password);
    setFieldError(parsed.success ? undefined : parsed.error.issues[0]?.message);
    if (!parsed.success) return;
    setSubmitting(true);
    setError(null);
    try {
      await api('/auth/password/reset', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <AuthCard title="Password changed" description="Your password was reset and all devices were signed out.">
        <Button asChild className="w-full">
          <Link href="/login">Sign in</Link>
        </Button>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={onSubmit} className="space-y-4">
        <FormError message={token ? error : 'This link is missing its code. Request a new reset email.'} />
        <Field
          id="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldError}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        />
        <Button type="submit" className="w-full" disabled={submitting || !token}>
          {submitting ? 'Saving…' : 'Save new password'}
        </Button>
      </form>
    </AuthCard>
  );
}
