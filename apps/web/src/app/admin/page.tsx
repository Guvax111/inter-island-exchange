'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useMe } from '@/lib/session';

const ORDER: [string, string][] = [
  ['seller.review', '/admin/sellers'],
  ['product.review', '/admin/products'],
  ['user.read.any', '/admin/users'],
  ['country.manage', '/admin/countries'],
];

/** Opens the first admin section the user can use (review queues first). */
export default function AdminIndex() {
  const { data: me } = useMe();
  const router = useRouter();
  useEffect(() => {
    const target = ORDER.find(([perm]) => me?.permissions.includes(perm));
    if (target) router.replace(target[1]);
  }, [me, router]);
  return null;
}
