'use client';

import type { ReactNode } from 'react';
import { RequireSignIn } from '@/components/account/require-signin';

export default function PartnerLayout({ children }: { children: ReactNode }) {
  return (
    <RequireSignIn>
      {(me) =>
        me.permissions.includes('shipment.read.assigned') ? (
          <>{children}</>
        ) : (
          <section className="container py-12">
            <p className="text-muted-foreground">The partner portal is for IIE logistics partners and customs brokers. Contact IIE if you should have access.</p>
          </section>
        )
      }
    </RequireSignIn>
  );
}
