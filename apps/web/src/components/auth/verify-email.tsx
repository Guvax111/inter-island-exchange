'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/api';
import { useRefreshMe } from '@/lib/session';
import { AuthCard } from './auth-card';

export function VerifyEmail() {
  const token = useSearchParams().get('token');
  const refresh = useRefreshMe();
  const [state, setState] = useState<'working' | 'done' | 'error'>(token ? 'working' : 'error');
  const [message, setMessage] = useState(token ? '' : 'This link is missing its code. Open the link from your email again.');
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api('/auth/verify-email', { method: 'POST', body: { token } })
      .then(async () => {
        setState('done');
        await refresh();
      })
      .catch((err) => {
        setState('error');
        setMessage(errorMessage(err));
      });
  }, [token, refresh]);

  if (state === 'working') return <AuthCard title="Confirming your email…">{null}</AuthCard>;
  if (state === 'error') {
    return (
      <AuthCard title="We could not confirm your email" description={message}>
        <p className="text-sm text-muted-foreground">Sign in and choose “Resend confirmation email” from your account page.</p>
        <Button asChild className="mt-6 w-full">
          <Link href="/account">Go to my account</Link>
        </Button>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Email confirmed" description="Thank you. Your email address is confirmed.">
      <Button asChild className="w-full">
        <Link href="/account">Continue</Link>
      </Button>
    </AuthCard>
  );
}
