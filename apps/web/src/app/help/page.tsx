import Link from 'next/link';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { serverGet } from '@/lib/server-api';
import { HELP_AUDIENCE_LABELS, type HelpArticleSummary } from '@/lib/types';

export const metadata = { title: 'Help Center', description: 'Guides and answers for buyers, sellers and partners on Inter-Island Exchange.' };

type Props = { searchParams: Promise<{ q?: string; for?: string }> };
const TABS = [
  { key: '', label: 'All' },
  { key: 'BUYER', label: 'Buying' },
  { key: 'SELLER', label: 'Selling' },
  { key: 'PARTNER', label: 'Partners' },
];

export default async function HelpPage({ searchParams }: Props) {
  const { q = '', for: audience = '' } = await searchParams;
  const tab = TABS.find((t) => t.key === audience) ?? TABS[0]!;
  const params = new URLSearchParams();
  if (tab.key) params.set('audience', tab.key);
  if (q.trim()) params.set('q', q.trim().slice(0, 100));
  // Searches are always fresh; the article lists are cached for a minute.
  const data = await serverGet<{ items: HelpArticleSummary[] }>(`/help?${params}`, q.trim() ? 0 : 60);
  const items = data?.items ?? [];
  const groups = q.trim() ? [['Results', items] as const] : (['ALL', 'BUYER', 'SELLER', 'PARTNER'] as const).map((a) => [HELP_AUDIENCE_LABELS[a], items.filter((i) => i.audience === a)] as const);

  return (
    <section className="container max-w-4xl py-10">
      <h1 className="text-3xl font-bold text-ocean-900">Help Center</h1>
      <p className="mt-2 text-muted-foreground">Answers for buyers, sellers and partners. Can’t find what you need? <Link href="/messages/new" className="underline">Message IIE</Link>.</p>
      <form className="mt-6 flex max-w-xl gap-2" action="/help" role="search">
        {tab.key && <input type="hidden" name="for" value={tab.key} />}
        <Input name="q" defaultValue={q} placeholder="Search help, e.g. duties, refund, payout" aria-label="Search help" maxLength={100} />
        <Button type="submit">
          <Search className="h-4 w-4" aria-hidden /> Search
        </Button>
      </form>
      <nav className="mt-4 flex gap-2" aria-label="Help topics">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/help${t.key ? `?for=${t.key}` : ''}`}
            className={`rounded-full border px-3 py-1 text-sm ${t.key === tab.key ? 'bg-ocean-900 text-white' : ''}`}
            aria-current={t.key === tab.key ? 'page' : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <p className="mt-8 text-muted-foreground">{q ? `No articles match “${q}”.` : 'Help articles are being prepared. In the meantime, message IIE with any question.'}</p>
      ) : (
        groups
          .filter(([, list]) => list.length)
          .map(([title, list]) => (
            <div key={title} className="mt-8">
              <h2 className="text-lg font-semibold">{title}</h2>
              <ul className="mt-2 divide-y rounded-lg border">
                {list.map((a) => (
                  <li key={a.slug}>
                    <Link href={`/help/${a.slug}`} className="block p-3 hover:bg-muted">
                      <span className="font-medium text-ocean-800">{a.title}</span>
                      {a.summary && <span className="block text-sm text-muted-foreground">{a.summary}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))
      )}
    </section>
  );
}
