'use client';

import { NextActionBanner } from '@/components/account/next-action';
import { RequireSignIn } from '@/components/account/require-signin';
import { ChangePassword, DeleteAccount, Sessions, TwoStep } from '@/components/account/security';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const ROLE_LABELS: Record<string, string> = { buyer: 'Buyer', seller: 'Seller' };
const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Details needed',
  PENDING_VERIFICATION: 'Waiting for email confirmation',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  REJECTED: 'Not approved',
};

export default function AccountPage() {
  return (
    <section className="container max-w-4xl space-y-6 py-10">
      <RequireSignIn>
        {(me) => (
          <>
            <div>
              <h1 className="text-3xl font-bold text-ocean-900">Hello, {me.user.firstName}</h1>
              <p className="mt-1 text-muted-foreground">
                {me.user.email} · {me.user.country.name}
              </p>
            </div>
            <NextActionBanner me={me} />
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Account</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p>
                    Status: <Badge variant="secondary">{STATUS_LABELS[me.user.status] ?? me.user.status}</Badge>
                  </p>
                  <p>Roles: {me.roles.map((r) => ROLE_LABELS[r] ?? r.replace(/_/g, ' ')).join(', ')}</p>
                  <p>Currency: {me.user.country.currency.code}</p>
                  {me.buyerProfile && <p>Buyer level: {me.buyerProfile.verificationLevel.toLowerCase()}</p>}
                </CardContent>
              </Card>
              {me.sellerProfile && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Seller application</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p className="font-medium">{me.sellerProfile.legalName}</p>
                    <p>Category: {me.sellerProfile.category}</p>
                    <p>
                      Status: <Badge variant="secondary">{STATUS_LABELS[me.sellerProfile.status] ?? me.sellerProfile.status}</Badge>
                    </p>
                    <p className="text-muted-foreground">Storefronts and product listings open in the next release.</p>
                  </CardContent>
                </Card>
              )}
            </div>
            <h2 className="pt-4 text-xl font-semibold">Security</h2>
            <div className="grid gap-6 md:grid-cols-2">
              <ChangePassword />
              <TwoStep me={me} />
            </div>
            <Sessions />
            <DeleteAccount />
          </>
        )}
      </RequireSignIn>
    </section>
  );
}
