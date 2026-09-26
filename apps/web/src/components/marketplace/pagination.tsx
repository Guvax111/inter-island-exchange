import Link from 'next/link';

/** Link-based pagination that keeps the current query string. Works without JavaScript. */
export function Pagination({ page, pageSize, total, params, basePath }: { page: number; pageSize: number; total: number; params: Record<string, string>; basePath: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => `${basePath}?${new URLSearchParams({ ...params, page: String(p) })}`;
  return (
    <nav className="mt-6 flex items-center justify-center gap-4 text-sm" aria-label="Pages">
      {page > 1 ? <Link href={href(page - 1)} className="underline">Previous</Link> : <span className="text-muted-foreground">Previous</span>}
      <span>
        Page {page} of {pages}
      </span>
      {page < pages ? <Link href={href(page + 1)} className="underline">Next</Link> : <span className="text-muted-foreground">Next</span>}
    </nav>
  );
}
