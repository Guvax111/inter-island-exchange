'use client';

import { useEffect, useState } from 'react';

/** "Reserved for 27 min" countdown to the payment deadline. */
export function PaymentCountdown({ dueAt }: { dueAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const minutes = Math.max(0, Math.ceil((new Date(dueAt).getTime() - now) / 60_000));
  return <span>{minutes > 0 ? `${minutes} min left` : 'Expiring now'} (until {new Date(dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})</span>;
}
