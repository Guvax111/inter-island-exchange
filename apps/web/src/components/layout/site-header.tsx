'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bell, Menu, ShoppingCart, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { PRIMARY_NAV } from '@/lib/navigation';
import { useMe, useRefreshMe } from '@/lib/session';
import type { NotificationList } from '@/lib/types';
import { cn } from '@/lib/utils';

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { data: me } = useMe();
  const refresh = useRefreshMe();
  useEffect(() => setOpen(false), [pathname]);

  const { data: bell } = useQuery({
    queryKey: ['notifications'],
    enabled: !!me,
    refetchInterval: 60_000,
    queryFn: () => api<NotificationList>('/me/notifications'),
  });
  const ADMIN_PERMISSIONS = ['user.read.any', 'country.manage', 'seller.review', 'product.review', 'transaction.read.any', 'support.respond', 'review.moderate', 'content.manage', 'report.read'];
  const isAdmin = ADMIN_PERMISSIONS.some((p) => me?.permissions.includes(p));
  const isPartner = !!me?.permissions.includes('shipment.read.assigned');
  const dashboard = me?.roles.includes('seller') ? '/dashboard/seller' : me?.roles.includes('buyer') ? '/dashboard/buyer' : null;

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    await refresh();
    router.push('/');
  }

  const account = me ? (
    <>
      <Button asChild variant="ghost" size="sm">
        <Link href="/notifications" aria-label={`Notifications${bell?.unread ? `, ${bell.unread} unread` : ''}`} className="relative">
          <Bell className="h-4 w-4" aria-hidden />
          {!!bell?.unread && (
            <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-coral-500 px-1 text-center text-[10px] font-bold leading-4 text-white">{bell.unread > 9 ? '9+' : bell.unread}</span>
          )}
        </Link>
      </Button>
      {me.roles.includes('buyer') && (
        <Button asChild variant="ghost" size="sm">
          <Link href="/orders">My orders</Link>
        </Button>
      )}
      {me.roles.includes('buyer') && (
        <Button asChild variant="ghost" size="sm">
          <Link href="/cart" aria-label="Cart">
            <ShoppingCart className="h-4 w-4" aria-hidden /> Cart
          </Link>
        </Button>
      )}
      {dashboard && (
        <Button asChild variant="ghost" size="sm">
          <Link href={dashboard}>Dashboard</Link>
        </Button>
      )}
      {isPartner && (
        <Button asChild variant="ghost" size="sm">
          <Link href="/partner">Partner portal</Link>
        </Button>
      )}
      {isAdmin && (
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin">Admin</Link>
        </Button>
      )}
      <Button asChild variant="ghost" size="sm">
        <Link href="/messages">Messages</Link>
      </Button>
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
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="Inter-Island Exchange home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/iie-logo.webp" alt="IIE" width={71} height={40} className="h-10 w-auto" />
          <span className="hidden whitespace-nowrap font-semibold text-ocean-900 lg:inline">Inter-Island Exchange</span>
        </Link>
        <nav className="hidden items-center gap-1 2xl:flex" aria-label="Primary">
          {PRIMARY_NAV.filter((n) => n.href !== '/').map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'whitespace-nowrap rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-muted hover:text-ocean-800',
                pathname === item.href && 'font-semibold text-ocean-800',
              )}
            >
              {item.label === 'Payment & Transaction Security' ? 'Payment Security' : item.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 2xl:flex">{account}</div>
        <button
          className="rounded-md p-2 2xl:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>
      {open && (
        <nav id="mobile-nav" className="border-t bg-white 2xl:hidden" aria-label="Primary">
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
