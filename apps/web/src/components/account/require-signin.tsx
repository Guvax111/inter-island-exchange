'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useMe, type Me } from '@/lib/session';

/** Client-side redirect for guests. The API enforces access on every request regardless. */
export function RequireSignIn({ children }: { children: (me: Me) => ReactNode }) {
  const { data: me, isLoading, error } = useMe();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && me === null) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [isLoading, me, pathname, router]);

  if (error) return <p className="container py-12 text-destructive">Could not load your account. Please refresh the page.</p>;
  if (!me) return <p className="container py-12 text-muted-foreground">Loading…</p>;
  return <>{children(me)}</>;
}
