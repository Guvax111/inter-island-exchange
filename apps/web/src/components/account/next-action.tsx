'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/api';
import type { Me } from '@/lib/session';

/** "What do I do next?" — every dashboard leads with the account's status and the one action needed. */
export function NextActionBanner({ me }: { me: Me }) {
  const [resend, setResend] = useState<string | null>(null);

  async function resendEmail() {
    try {
      await api('/auth/resend-verification', { method: 'POST' });
      setResend(`We sent a new link to ${me.user.email}.`);
    } catch (err) {
      setResend(errorMessage(err));
    }
  }

  switch (me.nextAction) {
    case 'VERIFY_EMAIL':
      return (
        <Banner tone="action" title="Confirm your email address" body={`Open the link we sent to ${me.user.email}.`}>
          <Button size="sm" variant="outline" onClick={resendEmail}>
            Resend confirmation email
          </Button>
          {!me.user.onboardingSubmitted && (
            <Button asChild size="sm">
              <Link href="/onboarding">Complete your details meanwhile</Link>
            </Button>
          )}
          {resend && <p className="w-full text-sm">{resend}</p>}
        </Banner>
      );
    case 'COMPLETE_ONBOARDING':
      return (
        <Banner tone="action" title="Complete your account details" body="Tell us a little more so your account can be activated.">
          <Button asChild size="sm">
            <Link href="/onboarding">Complete details</Link>
          </Button>
        </Banner>
      );
    case 'ACCOUNT_UNDER_REVIEW':
      return <Banner tone="wait" title="Your account is under review" body="Our team is checking your details. We will email you when this is done." />;
    case 'SELLER_UNDER_REVIEW':
      return (
        <Banner
          tone="wait"
          title="Your seller application is under review"
          body="IIE reviews every seller before they can list products. We will email you when a decision is made. No action is needed from you."
        />
      );
    default:
      return <Banner tone="ok" title="Your account is active" body="There is nothing you need to do right now." />;
  }
}

function Banner({ tone, title, body, children }: { tone: 'action' | 'wait' | 'ok'; title: string; body: string; children?: React.ReactNode }) {
  const styles = {
    action: { box: 'border-coral-400 bg-orange-50', Icon: AlertCircle, icon: 'text-coral-600' },
    wait: { box: 'border-ocean-600 bg-ocean-50', Icon: Clock, icon: 'text-ocean-700' },
    ok: { box: 'border-emerald-500 bg-emerald-50', Icon: CheckCircle2, icon: 'text-emerald-600' },
  }[tone];
  return (
    <div role="status" className={`flex gap-3 rounded-lg border-l-4 p-4 ${styles.box}`}>
      <styles.Icon className={`mt-0.5 h-5 w-5 shrink-0 ${styles.icon}`} aria-hidden />
      <div className="flex-1">
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-slate-700">{body}</p>
        {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
      </div>
    </div>
  );
}
