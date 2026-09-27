'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { RequireSignIn } from '@/components/account/require-signin';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/admin/transactions', label: 'Transactions', permission: 'transaction.read.any' },
  { href: '/admin/disputes', label: 'Disputes', permission: 'transaction.read.any' },
  { href: '/admin/tariffs', label: 'Tariffs', permission: 'config.manage' },
  { href: '/admin/logistics', label: 'Logistics', permission: 'partner.manage' },
  { href: '/admin/payouts', label: 'Payouts', permission: 'payout.approve' },
  { href: '/admin/settlements', label: 'Settlements', permission: 'payout.approve' },
  { href: '/admin/support', label: 'Messages', permission: 'support.respond' },
  { href: '/admin/reviews', label: 'Reviews', permission: 'review.moderate' },
  { href: '/admin/help', label: 'Help Center', permission: 'content.manage' },
  { href: '/admin/reports', label: 'Reports', permission: 'report.read' },
  { href: '/admin/users', label: 'Users', permission: 'user.read.any' },
  { href: '/admin/sellers', label: 'Sellers', permission: 'seller.review' },
  { href: '/admin/products', label: 'Products', permission: 'product.review' },
  { href: '/admin/categories', label: 'Categories', permission: 'category.manage' },
  { href: '/admin/countries', label: 'Countries', permission: 'country.manage' },
  { href: '/admin/checkout-settings', label: 'Checkout settings', permission: 'config.manage' },
  { href: '/admin/exchange-rates', label: 'Exchange rates', permission: 'config.manage' },
  { href: '/admin/audit', label: 'Audit log', permission: 'audit.read' },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <section className="container py-8">
      <RequireSignIn>
        {(me) => {
          const tabs = TABS.filter((t) => me.permissions.includes(t.permission));
          if (!tabs.length) return <p className="text-muted-foreground">You do not have access to administration.</p>;
          return (
            <>
              <h1 className="text-2xl font-bold text-ocean-900">Administration</h1>
              <nav className="mt-4 flex gap-1 overflow-x-auto border-b" aria-label="Administration">
                {tabs.map((t) => (
                  <Link
                    key={t.href}
                    href={t.href}
                    className={cn('whitespace-nowrap border-b-2 px-4 py-2 text-sm', pathname.startsWith(t.href) ? 'border-ocean-700 font-semibold text-ocean-800' : 'border-transparent text-muted-foreground')}
                  >
                    {t.label}
                  </Link>
                ))}
              </nav>
              <div className="pt-6">{children}</div>
            </>
          );
        }}
      </RequireSignIn>
    </section>
  );
}
