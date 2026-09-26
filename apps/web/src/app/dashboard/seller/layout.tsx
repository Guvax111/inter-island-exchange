'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { RequireSignIn } from '@/components/account/require-signin';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/dashboard/seller', label: 'Overview', exact: true },
  { href: '/dashboard/seller/products', label: 'Products' },
  { href: '/dashboard/seller/store', label: 'Store profile' },
];

export default function SellerDashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <section className="container max-w-5xl py-8">
      <RequireSignIn>
        {(me) =>
          !me.roles.includes('seller') ? (
            <p className="text-muted-foreground">This dashboard is for seller accounts.</p>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-ocean-900">Seller dashboard</h1>
              <nav className="mt-4 flex gap-1 overflow-x-auto border-b" aria-label="Seller dashboard">
                {TABS.map((t) => {
                  const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
                  return (
                    <Link key={t.href} href={t.href} className={cn('whitespace-nowrap border-b-2 px-4 py-2 text-sm', active ? 'border-ocean-700 font-semibold text-ocean-800' : 'border-transparent text-muted-foreground')}>
                      {t.label}
                    </Link>
                  );
                })}
              </nav>
              <div className="pt-6">{children}</div>
            </>
          )
        }
      </RequireSignIn>
    </section>
  );
}
