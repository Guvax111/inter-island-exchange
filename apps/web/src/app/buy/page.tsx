import Link from 'next/link';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Buy' };

export default function BuyPage() {
  return (
    <section className="container max-w-3xl py-12">
      <h1 className="text-3xl font-bold text-ocean-900">Buy from across the islands</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        IIE lets you buy from verified sellers in other CARICOM countries and see the full cost, including shipping, duties and fees, before you pay.
      </p>
      <ul className="mt-6 list-disc space-y-2 pl-6 text-muted-foreground">
        <li>Register with your country and delivery address.</li>
        <li>Confirm your email to activate your account.</li>
        <li>When the marketplace opens, shop, pay securely and track your delivery.</li>
      </ul>
      <p className="mt-6 rounded-md bg-muted p-4 text-sm">
        The marketplace is not open yet. Buyers in St. Vincent and the Grenadines can register now for the first launch.
      </p>
      <Button asChild className="mt-8">
        <Link href="/signup?type=BUYER">Register as a Buyer</Link>
      </Button>
    </section>
  );
}
