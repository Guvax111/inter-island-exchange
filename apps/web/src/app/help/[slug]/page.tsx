import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Markdown } from '@/components/help/markdown';
import { serverGet } from '@/lib/server-api';
import { HELP_AUDIENCE_LABELS, type HelpArticle } from '@/lib/types';

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  return /^[a-z0-9-]{1,60}$/.test(slug) ? serverGet<HelpArticle>(`/help/${slug}`, 60) : null;
}

export async function generateMetadata({ params }: Props) {
  const a = await load((await params).slug);
  return { title: a?.title ?? 'Help article not found', description: a?.summary };
}

export default async function HelpArticlePage({ params }: Props) {
  const a = await load((await params).slug);
  if (!a) notFound();
  return (
    <article className="container max-w-3xl py-10">
      <p className="text-sm">
        <Link href="/help" className="underline">
          Help Center
        </Link>{' '}
        · {HELP_AUDIENCE_LABELS[a.audience]}
      </p>
      <h1 className="mt-2 text-3xl font-bold text-ocean-900">{a.title}</h1>
      {a.summary && <p className="mt-2 text-lg text-muted-foreground">{a.summary}</p>}
      <div className="mt-4 text-slate-800">
        <Markdown source={a.body} />
      </div>
      <p className="mt-10 border-t pt-4 text-sm text-muted-foreground">
        Updated {new Date(a.updatedAt).toLocaleDateString()}. Still need help? <Link href="/messages/new" className="underline">Message IIE</Link>.
      </p>
    </article>
  );
}
