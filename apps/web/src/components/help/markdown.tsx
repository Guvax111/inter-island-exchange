import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';

/**
 * Renders the small Markdown subset Help articles use: "## " and "### " headings, paragraphs, "- " and "1. " lists,
 * **bold** and [links](/path). Everything is built as React elements (no raw HTML), and links may only point to IIE
 * pages ("/...") or https sites, so article text cannot inject markup or scripts.
 */
export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    if (heading) {
      const Tag = heading[1]!.length === 2 ? 'h2' : 'h3';
      blocks.push(
        <Tag key={i} className={Tag === 'h2' ? 'mt-6 text-xl font-semibold text-ocean-900' : 'mt-4 font-semibold text-ocean-900'}>
          {inline(heading[2]!)}
        </Tag>,
      );
      i++;
      continue;
    }
    const listKind = /^\s*-\s+/.test(line) ? 'ul' : /^\s*\d+\.\s+/.test(line) ? 'ol' : null;
    if (listKind) {
      const items: string[] = [];
      const pattern = listKind === 'ul' ? /^\s*-\s+(.*)$/ : /^\s*\d+\.\s+(.*)$/;
      while (i < lines.length && pattern.test(lines[i]!)) items.push(pattern.exec(lines[i++]!)![1]!);
      const List = listKind;
      blocks.push(
        <List key={i} className={`mt-3 space-y-1 pl-6 ${listKind === 'ul' ? 'list-disc' : 'list-decimal'}`}>
          {items.map((it, k) => (
            <li key={k}>{inline(it)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{2,3}\s|\s*-\s|\s*\d+\.\s)/.test(lines[i]!)) para.push(lines[i++]!.trim());
    blocks.push(
      <p key={i} className="mt-3">
        {inline(para.join(' '))}
      </p>,
    );
  }
  return <div className="leading-relaxed">{blocks}</div>;
}

const SAFE_HREF = /^(\/(?!\/)[^\s]*|https:\/\/[^\s]+)$/;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<Fragment key={k++}>{text.slice(last, m.index)}</Fragment>);
    if (m[1] !== undefined) {
      out.push(<strong key={k++}>{m[1]}</strong>);
    } else if (SAFE_HREF.test(m[3]!)) {
      out.push(
        m[3]!.startsWith('/') ? (
          <Link key={k++} href={m[3]!} className="underline">
            {m[2]}
          </Link>
        ) : (
          <a key={k++} href={m[3]!} className="underline" rel="noopener noreferrer" target="_blank">
            {m[2]}
          </a>
        ),
      );
    } else {
      out.push(<Fragment key={k++}>{m[2]}</Fragment>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(<Fragment key={k++}>{text.slice(last)}</Fragment>);
  return out;
}
