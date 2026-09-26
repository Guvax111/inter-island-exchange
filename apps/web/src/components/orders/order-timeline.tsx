import { AlertTriangle, CheckCircle2, Circle, CircleDot, XCircle } from 'lucide-react';
import type { OrderDetail } from '@/lib/types';

/** Milestones a buyer or seller cares about, and the transaction states that complete each one. */
const MILESTONES: { label: string; doneWhen: string[] }[] = [
  { label: 'Order placed', doneWhen: ['AWAITING_PAYMENT'] },
  { label: 'Payment confirmed', doneWhen: ['PAYMENT_CONFIRMED'] },
  { label: 'Seller confirmed', doneWhen: ['SELLER_CONFIRMED'] },
  { label: 'Picked up and shipped', doneWhen: ['PICKED_UP'] },
  { label: 'Cleared customs', doneWhen: ['CUSTOMS_CLEARED'] },
  { label: 'Delivered', doneWhen: ['DELIVERED'] },
  { label: 'Completed', doneWhen: ['COMPLETED'] },
];
const STOPPED = ['CANCELLED', 'REFUNDED', 'PAYMENT_FAILED'];
const HOLDS = ['CUSTOMS_HOLD', 'COMPLIANCE_HOLD', 'DISPUTED'];

export function OrderTimeline({ order }: { order: OrderDetail }) {
  const reached = new Set(order.timeline.map((e) => e.status));
  const done = MILESTONES.map((m) => m.doneWhen.some((s) => reached.has(s)));
  const nextIndex = done.lastIndexOf(true) + 1;
  const stopped = STOPPED.includes(order.status);
  const held = HOLDS.includes(order.status);

  return (
    <div>
      <ol className="space-y-3" aria-label="Order progress">
        {MILESTONES.map((m, i) => {
          const isDone = done[i];
          const isCurrent = !stopped && i === nextIndex;
          return (
            <li key={m.label} className="flex items-center gap-3">
              {isDone ? (
                <CheckCircle2 className="h-5 w-5 text-palm-600" aria-label="Done" />
              ) : isCurrent ? (
                held ? <AlertTriangle className="h-5 w-5 text-coral-500" aria-label="On hold" /> : <CircleDot className="h-5 w-5 text-ocean-600" aria-label="In progress" />
              ) : (
                <Circle className="h-5 w-5 text-slate-300" aria-label="Not yet" />
              )}
              <span className={isDone ? 'font-medium' : isCurrent ? 'font-semibold text-ocean-800' : 'text-muted-foreground'}>
                {m.label}
                {isCurrent && !isDone && <span className="ml-2 text-xs font-normal text-muted-foreground">{held ? order.statusLabel : 'Next step'}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {stopped && (
        <p className="mt-3 flex items-center gap-2 text-sm font-medium text-destructive">
          <XCircle className="h-4 w-4" aria-hidden /> {order.statusLabel}
        </p>
      )}
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-muted-foreground">Full history</summary>
        <ul className="mt-2 space-y-1">
          {order.timeline.map((e, i) => (
            <li key={i}>
              <span className="text-muted-foreground">{new Date(e.at).toLocaleString()}</span> — {e.label}
              {e.reason && <span className="text-muted-foreground"> ({e.reason})</span>}
              {e.actorType && <span className="ml-1 text-xs text-muted-foreground">by {e.actorType.toLowerCase()}</span>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
