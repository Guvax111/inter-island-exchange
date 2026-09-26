import Link from 'next/link';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Sell' };

export default function SellPage() {
  return (
    <section className="container max-w-3xl py-12">
      <h1 className="text-3xl font-bold text-ocean-900">Sell to buyers across CARICOM</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Reach customers in other islands without building your own export operation. IIE coordinates payment, logistics and customs paperwork.
      </p>
      <h2 className="mt-8 text-xl font-semibold">How to become a seller</h2>
      <ol className="mt-4 list-decimal space-y-2 pl-6 text-muted-foreground">
        <li>Create a seller account and confirm your email.</li>
        <li>Tell us about yourself or your business: legal name, registration number, tax details and address.</li>
        <li>IIE reviews your application. You will see the status in your account.</li>
        <li>Once approved, set up your storefront and list products (coming in the next release).</li>
      </ol>
      <p className="mt-6 rounded-md bg-muted p-4 text-sm">Seller applications are open now for businesses in St. Lucia.</p>
      <Button asChild className="mt-8">
        <Link href="/signup?type=SELLER">Become a Seller</Link>
      </Button>
    </section>
  );
}
