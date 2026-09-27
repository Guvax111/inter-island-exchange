import type { PublicReview } from '@/lib/types';
import { Stars } from './stars';

/** Published reviews (IIE approves each one before it appears). */
export function ReviewList({ reviews }: { reviews: PublicReview[] }) {
  if (!reviews.length) return <p className="text-sm text-muted-foreground">No reviews yet.</p>;
  return (
    <ul className="divide-y">
      {reviews.map((r, i) => (
        <li key={i} className="py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Stars value={r.rating} />
            {r.title && <span className="font-semibold">{r.title}</span>}
          </div>
          {r.body && <p className="mt-1 whitespace-pre-line">{r.body}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {r.reviewer}, {r.reviewerCountry} · {new Date(r.at).toLocaleDateString()}
          </p>
        </li>
      ))}
    </ul>
  );
}
