'use client';

import { useEffect, useState } from 'react';

/** "31 h 20 min left (until Sat 14:05)" countdown to a deadline measured in hours. */
export function HoursCountdown({ dueAt }: { dueAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const minutes = Math.max(0, Math.floor((new Date(dueAt).getTime() - now) / 60_000));
  const left = minutes > 0 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min left` : 'Time is up';
  return <span>{left} (until {new Date(dueAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })})</span>;
}
