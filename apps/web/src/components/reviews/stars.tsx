import { cn } from '@/lib/utils';
import type { Rating } from '@/lib/types';

/** Five stars, filled to the (rounded) rating. Screen readers hear "4.5 out of 5". */
export function Stars({ value, className }: { value: number; className?: string }) {
  const filled = Math.round(value);
  return (
    <span className={cn('inline-flex text-amber-500', className)} role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} aria-hidden="true" className={i <= filled ? '' : 'text-slate-300'}>
          ★
        </span>
      ))}
    </span>
  );
}

/** "★★★★☆ 4.2 (12 reviews)", or a note that there are none yet. */
export function RatingSummary({ rating, empty = 'No reviews yet' }: { rating: Rating | null; empty?: string }) {
  if (!rating) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <Stars value={rating.average} />
      <span className="font-medium">{rating.average.toFixed(1)}</span>
      <span className="text-muted-foreground">
        ({rating.count} {rating.count === 1 ? 'review' : 'reviews'})
      </span>
    </span>
  );
}
