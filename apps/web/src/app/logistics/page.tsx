import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { CONTACT } from '@/lib/navigation';

export const metadata = { title: 'Logistics' };

const STEPS = [
  { title: 'Packed by the seller', text: 'Once the seller confirms a paid order, they pack it and mark it ready for pickup.' },
  { title: 'Collected and shipped', text: 'IIE’s logistics partner for the route collects the parcel, weighs it and ships it between islands.' },
  { title: 'Customs', text: 'A customs broker in the destination country (or the logistics partner, where it clears customs itself) clears the parcel using the commercial invoice IIE prepares from the order.' },
  { title: 'Delivered', text: 'The partner delivers and records who received it and when, with a photo or signature where available.' },
  { title: 'Confirmed', text: 'The buyer confirms receipt or reports a problem within 3 days. Without an answer, the delivery is confirmed automatically.' },
];

export default function LogisticsPage() {
  return (
    <section className="container max-w-3xl py-12">
      <h1 className="text-3xl font-bold text-ocean-900">Logistics</h1>
      <p className="mt-3 text-muted-foreground">
        Every IIE order is shipped by an IIE logistics partner and cleared by a customs broker, and every step is recorded under the order’s IIE transaction ID.
      </p>
      <p className="mt-4 rounded-md bg-muted p-4 text-sm">
        <strong>Partner to be announced.</strong> IIE is selecting its logistics partner for St. Lucia → St. Vincent and the Grenadines. Shipping prices shown at checkout are provisional until then.
      </p>
      <h2 className="mt-8 text-xl font-semibold">From the seller to your door</h2>
      <ol className="mt-3 space-y-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ocean-900 text-sm font-semibold text-white">{i + 1}</span>
            <div>
              <p className="font-medium">{s.title}</p>
              <p className="text-sm text-muted-foreground">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-sm text-muted-foreground">
        Duties and taxes are paid by the buyer on arrival. Checkout shows an estimate; customs sets the final amount, which appears on your order once the parcel clears.
      </p>
      <h2 className="mt-8 text-xl font-semibold">Become an IIE logistics partner or customs broker</h2>
      <p className="mt-2 text-muted-foreground">
        Partners use the IIE partner portal to schedule pickups, update tracking, download commercial invoices and record deliveries. To discuss a partnership, contact IIE.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild>
          <a href={`mailto:${CONTACT.email}?subject=${encodeURIComponent('IIE logistics partnership')}`}>Email {CONTACT.email}</a>
        </Button>
        <Button asChild variant="outline">
          <Link href="/track">Track a shipment</Link>
        </Button>
      </div>
    </section>
  );
}
