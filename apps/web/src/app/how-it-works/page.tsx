import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'How It Works' };

const steps: { title: string; text: string; live: boolean | 'test' | 'partner' }[] = [
  { title: 'Register and verify', text: 'Create a buyer or seller account in your country and confirm your email.', live: true },
  { title: 'Seller review', text: 'IIE reviews each seller before they can open a storefront.', live: true },
  { title: 'List and discover products', text: 'Sellers list products after IIE review; buyers search across CARICOM and fill a cart.', live: true },
  { title: 'Checkout', text: 'See product cost, shipping, duties and taxes, and fees before you pay.', live: true },
  { title: 'Payment held safely', text: 'A licensed payment partner holds the payment while your order ships. The seller has 48 hours to confirm, or you are refunded automatically.', live: 'test' },
  { title: 'Shipping and customs', text: 'Logistics partners collect, export, clear customs and deliver. Track every step under your IIE transaction ID.', live: 'partner' },
  { title: 'Confirm delivery', text: 'You confirm your order arrived or report a problem within 3 days. Without an answer, the delivery is confirmed automatically.', live: true },
  { title: 'Seller paid', text: 'The payment is released to the seller and the transaction is complete.', live: false },
];

export default function HowItWorksPage() {
  return (
    <section className="container max-w-3xl py-12">
      <h1 className="text-3xl font-bold text-ocean-900">How Inter-Island Exchange works</h1>
      <p className="mt-3 text-lg text-muted-foreground">Every order follows the same clear path, all under one IIE transaction ID.</p>
      <ol className="mt-8 space-y-4">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-4 rounded-lg border p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ocean-700 font-semibold text-white">{i + 1}</span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">{step.title}</h2>
                <Badge variant={step.live === true ? 'default' : 'secondary'}>{step.live === true ? 'Available now' : step.live === 'test' ? 'Test mode' : step.live === 'partner' ? 'Partner to be announced' : 'Coming soon'}</Badge>
              </div>
              <p className="mt-1 text-muted-foreground">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <Button asChild className="mt-8">
        <Link href="/signup">Create your account</Link>
      </Button>
    </section>
  );
}
