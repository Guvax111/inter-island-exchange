import { Suspense } from 'react';
import { VerifyEmail } from '@/components/auth/verify-email';

export const metadata = { title: 'Confirm email' };

export default function Page() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
