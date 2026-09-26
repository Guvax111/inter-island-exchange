'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { PRIMARY_NAV } from '@/lib/navigation';
import { useMe, useRefreshMe } from '@/lib/session';
import { cn } from '@/lib/utils';

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { data: me } = useMe();
  const refresh = useRefreshMe();
  useEffect(() => setOpen(false), [pathname]);

  const isAdmin = me?.permissions.includes('user.read.any') || me?.permissions.includes('country.manage');

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    await refresh();
    router.push('/');
  }

  const account = me ? (
    <>
      {isAdmin && (
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin">Admin</Link>
        </Button>
      )}
      <Button asChild variant="outline" size="sm">
        <Link href="/account">My account</Link>
      </Button>
      <Button variant="ghost" size="sm" onClick={logout}>
        Log out
      </Button>
    </>
  ) : (
    <>
      <Button asChild variant="ghost" size="sm">
        <Link href="/login">Login</Link>
      </Button>
      <Button asChild size="sm">
        <Link href="/signup">Sign Up</Link>
      </Button>
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b bg-white/95 backdrop-blur">
      <div className="container flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2" aria-label="Inter-Island Exchange home">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ocean-700 text-sm font-bold text-white">IIE</span>
          <span className="hidden font-semibold text-ocean-900 sm:inline">Inter-Island Exchange</span>
        </Link>
        <nav className="hidden items-center gap-1 xl:flex" aria-label="Primary">
          {PRIMARY_NAV.filter((n) => n.href !== '/').map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-muted hover:text-ocean-800',
                pathname === item.href && 'font-semibold text-ocean-800',
              )}
            >
              {item.label === 'Payment & Transaction Security' ? 'Payment Security' : item.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 xl:flex">{account}</div>
        <button
          className="rounded-md p-2 xl:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>
      {open && (
        <nav id="mobile-nav" className="border-t bg-white xl:hidden" aria-label="Primary">
          <ul className="container grid gap-1 py-3">
            {PRIMARY_NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="flex items-center justify-between rounded-md px-2 py-3 text-base hover:bg-muted">
                  {item.label}
                  {item.status === 'coming-soon' && <span className="text-xs text-muted-foreground">Coming soon</span>}
                </Link>
              </li>
            ))}
            <li className="flex flex-wrap gap-2 pt-2">{account}</li>
          </ul>
        </nav>
      )}
    </header>
  );
}
