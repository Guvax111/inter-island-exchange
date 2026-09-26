import { Suspense } from 'react';
import { ForgotPasswordForm } from '@/components/auth/password-forms';

export const metadata = { title: 'Forgot password' };

export default function Page() {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  );
}
