import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <section className="container max-w-xl py-20 text-center">
      <h1 className="text-3xl font-bold text-ocean-900">Page not found</h1>
      <p className="mt-3 text-muted-foreground">We could not find that page.</p>
      <Button asChild className="mt-6">
        <Link href="/">Back to home</Link>
      </Button>
    </section>
  );
}
