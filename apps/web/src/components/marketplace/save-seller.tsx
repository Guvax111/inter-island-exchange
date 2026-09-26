'use client';

import { useState } from 'react';
import { Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useMe } from '@/lib/session';

export function SaveSellerButton({ slug }: { slug: string }) {
  const { data: me } = useMe();
  const [saved, setSaved] = useState(false);
  if (!me?.permissions.includes('saved.manage.own')) return null;
  async function toggle() {
    await api(`/me/saved/sellers/${slug}`, { method: saved ? 'DELETE' : 'PUT' });
    setSaved(!saved);
  }
  return (
    <Button variant="outline" onClick={toggle} aria-pressed={saved}>
      <Heart className={saved ? 'fill-coral-500 text-coral-500' : ''} aria-hidden /> {saved ? 'Saved' : 'Save seller'}
    </Button>
  );
}
