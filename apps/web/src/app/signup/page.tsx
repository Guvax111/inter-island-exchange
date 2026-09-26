import { Suspense } from 'react';
import { SignupForm } from '@/components/auth/signup-form';

export const metadata = { title: 'Sign Up' };

export default function Page() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
