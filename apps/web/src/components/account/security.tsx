'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useState, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH } from '@iie/shared';
import { Field, FormError } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useRefreshMe, type Me } from '@/lib/session';

export function ChangePassword() {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    try {
      await api('/auth/password/change', { method: 'POST', body: { currentPassword, newPassword } });
      setMessage('Password changed. Your other devices have been signed out.');
      setCurrent('');
      setNew('');
    } catch (err) {
      setError(err instanceof ApiError && err.fieldErrors.newPassword ? err.fieldErrors.newPassword : errorMessage(err));
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Password</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-3">
          <FormError message={error} />
          {message && <p className="text-sm text-emerald-700">{message}</p>}
          <Field id="currentPassword" label="Current password" type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
          <Field id="newPassword" label="New password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} value={newPassword} onChange={(e) => setNew(e.target.value)} hint={`At least ${PASSWORD_MIN_LENGTH} characters.`} />
          <Button type="submit" size="sm">
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function TwoStep({ me }: { me: Me }) {
  const refresh = useRefreshMe();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    try {
      const res = await api<{ secret: string; otpauthUrl: string }>('/auth/mfa/totp/setup', { method: 'POST' });
      setSetup({ secret: res.secret, qr: await QRCode.toDataURL(res.otpauthUrl) });
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function submit(action: 'confirm' | 'disable') {
    setError(null);
    try {
      await api(`/auth/mfa/totp/${action}`, { method: 'POST', body: { code } });
      setSetup(null);
      setCode('');
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const codeField = (
    <Field id="totp" label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Two-step verification</CardTitle>
        <CardDescription>
          {me.mfaEnabled ? 'On. You will be asked for a code from your authenticator app when you sign in.' : 'Off. Add a code from an authenticator app to your sign-in.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <FormError message={error} />
        {me.mfaEnabled ? (
          <>
            {codeField}
            <Button size="sm" variant="outline" onClick={() => submit('disable')}>
              Turn off
            </Button>
          </>
        ) : setup ? (
          <>
            <p className="text-sm">Scan this with an authenticator app (such as Google Authenticator or Microsoft Authenticator), then enter the code it shows.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} />
            <p className="break-all text-xs text-muted-foreground">Or enter this key manually: {setup.secret}</p>
            {codeField}
            <Button size="sm" onClick={() => submit('confirm')}>
              Turn on
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={start}>
            Set up two-step verification
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  lastSeenAt: string;
  current: boolean;
}

export function Sessions() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ items: SessionRow[] }>('/auth/sessions') });
  async function revoke(id: string) {
    await api(`/auth/sessions/${id}`, { method: 'DELETE' });
    await qc.invalidateQueries({ queryKey: ['sessions'] });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Signed-in devices</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {data?.items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{s.userAgent ?? 'Unknown device'}</p>
                <p className="text-muted-foreground">
                  {s.ip ?? 'Unknown IP'} · last active {new Date(s.lastSeenAt).toLocaleString()}
                </p>
              </div>
              {s.current ? (
                <span className="text-xs font-semibold text-emerald-700">This device</span>
              ) : (
                <Button size="sm" variant="outline" onClick={() => revoke(s.id)}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api<{ message: string }>('/me/deletion-request', { method: 'POST', body: { password, reason: reason || undefined } });
      setMessage(res.message);
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Close account</CardTitle>
        <CardDescription>Ask IIE to close your account and delete your personal data, subject to records we must keep by law.</CardDescription>
      </CardHeader>
      <CardContent>
        {message ? (
          <p className="text-sm">{message}</p>
        ) : open ? (
          <form onSubmit={onSubmit} className="space-y-3">
            <FormError message={error} />
            <Field id="deletePassword" label="Confirm your password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            <Field id="deleteReason" label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="destructive">
                Request account closure
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Request account closure
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
