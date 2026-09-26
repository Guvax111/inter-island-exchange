'use client';

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api, ApiError } from './api';

export type NextAction = 'VERIFY_EMAIL' | 'COMPLETE_ONBOARDING' | 'ACCOUNT_UNDER_REVIEW' | 'SELLER_UNDER_REVIEW' | 'NONE';

export interface Me {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    status: string;
    emailVerified: boolean;
    onboardingSubmitted: boolean;
    country: { code: string; name: string; currency: { code: string; symbol: string } };
    createdAt: string;
  };
  roles: string[];
  permissions: string[];
  mfaEnabled: boolean;
  buyerProfile: { partyType: string; verificationLevel: string } | null;
  sellerProfile: { id: string; partyType: string; legalName: string; category: string; status: string; storefrontSlug: string | null } | null;
  nextAction: NextAction;
  csrfToken: string;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** The signed-in user, or null for guests. */
export function useMe() {
  return useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api<Me>('/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
  });
}

export function useRefreshMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['me'] });
}
