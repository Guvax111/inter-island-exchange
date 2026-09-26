'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface MySeller {
  profile: {
    id: string;
    status: string;
    partyType: string;
    legalName: string;
    businessName: string | null;
    registrationNumber: string | null;
    taxId: string | null;
    phone: string;
    website: string | null;
    category: string;
    reviewNotes: string | null;
    payoutSetupConfirmed: boolean;
  };
  storefront: {
    slug: string;
    displayName: string;
    description: string;
    logoUrl: string | null;
    shippingOrigin: string;
    returnPolicy: string;
    storePolicies: string;
  } | null;
  productCounts: Record<string, number>;
}

export const useMySeller = () => useQuery({ queryKey: ['my-seller'], queryFn: () => api<MySeller>('/me/seller') });
