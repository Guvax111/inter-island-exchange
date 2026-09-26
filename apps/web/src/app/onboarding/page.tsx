'use client';

import Link from 'next/link';
import { OnboardingForm } from '@/components/account/onboarding-form';
import { RequireSignIn } from '@/components/account/require-signin';
import { Button } from '@/components/ui/button';

export default function OnboardingPage() {
  return (
    <section className="container max-w-3xl py-10">
      <RequireSignIn>
        {(me) =>
          me.user.onboardingSubmitted ? (
            <div>
              <h1 className="text-2xl font-bold text-ocean-900">Your details are submitted</h1>
              <Button asChild className="mt-6">
                <Link href="/account">Go to my account</Link>
              </Button>
            </div>
          ) : (
            <>
              <h1 className="text-3xl font-bold text-ocean-900">Complete your account</h1>
              <p className="mb-6 mt-2 text-muted-foreground">
                Registered in {me.user.country.name}. Your account becomes active once these details are submitted and your email is confirmed.
              </p>
              <OnboardingForm me={me} />
            </>
          )
        }
      </RequireSignIn>
    </section>
  );
}
