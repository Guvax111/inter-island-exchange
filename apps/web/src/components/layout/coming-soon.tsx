import Link from 'next/link';
import { Construction } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ComingSoon({ title, phase, summary }: { title: string; phase: string; summary: string }) {
  return (
    <section className="container max-w-2xl py-20 text-center">
      <Construction className="mx-auto h-12 w-12 text-coral-500" aria-hidden />
      <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-coral-600">Coming soon</p>
      <h1 className="mt-2 text-3xl font-bold text-ocean-900">{title}</h1>
      <p className="mt-4 text-lg text-muted-foreground">{summary}</p>
      <p className="mt-2 text-sm text-muted-foreground">This section is planned for {phase} of the IIE rollout and is not available yet.</p>
      <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
        <Button asChild>
          <Link href="/signup">Create an account now</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/how-it-works">How IIE works</Link>
        </Button>
      </div>
    </section>
  );
}
