import Link from 'next/link';
import { Globe2, PackageSearch, ShieldCheck, ShoppingBag, Store, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ctas = [
  { href: '/marketplace', label: 'Shop the Marketplace', icon: ShoppingBag },
  { href: '/signup?type=SELLER', label: 'Become a Seller', icon: Store },
  { href: '/signup?type=BUYER', label: 'Register as a Buyer', icon: PackageSearch },
  { href: '/countries', label: 'Explore Countries', icon: Globe2 },
  { href: '/track', label: 'Track a Shipment', icon: Truck, soon: true },
];

export default function HomePage() {
  return (
    <>
      <section className="bg-gradient-to-br from-ocean-900 via-ocean-800 to-ocean-600 text-white">
        <div className="container py-16 md:py-24">
          <p className="text-sm font-semibold uppercase tracking-widest text-ocean-100">Inter-Island Exchange</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-bold leading-tight md:text-6xl">
            A secure digital marketplace connecting buyers and sellers across CARICOM.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-ocean-100">
            Buy from verified regional sellers, with every order tracked from payment to delivery under one IIE transaction ID.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" className="bg-coral-500 hover:bg-coral-600">
              <Link href="/signup?type=BUYER">Register as a Buyer</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white bg-transparent text-white hover:bg-white/10 hover:text-white">
              <Link href="/signup?type=SELLER">Become a Seller</Link>
            </Button>
          </div>
          <p className="mt-6 text-sm text-ocean-100">Now onboarding: sellers in St. Lucia and buyers in St. Vincent and the Grenadines.</p>
        </div>
      </section>

      <section className="container py-12" aria-labelledby="start">
        <h2 id="start" className="text-2xl font-bold text-ocean-900">Get started</h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {ctas.map(({ href, label, icon: Icon, soon }) => (
            <li key={href}>
              <Link href={href} className="flex h-full flex-col gap-3 rounded-lg border p-5 transition hover:border-ocean-600 hover:shadow-md">
                <Icon className="h-7 w-7 text-ocean-700" aria-hidden />
                <span className="font-semibold">{label}</span>
                {soon && <span className="text-xs text-muted-foreground">Coming soon</span>}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-muted/60">
        <div className="container grid gap-8 py-12 md:grid-cols-3">
          <div>
            <ShieldCheck className="h-8 w-8 text-ocean-700" aria-hidden />
            <h3 className="mt-3 text-lg font-semibold">Verified sellers</h3>
            <p className="mt-1 text-muted-foreground">Every seller is reviewed by IIE before they can list products.</p>
          </div>
          <div>
            <ShieldCheck className="h-8 w-8 text-ocean-700" aria-hidden />
            <h3 className="mt-3 text-lg font-semibold">Transaction Safeguard</h3>
            <p className="mt-1 text-muted-foreground">
              Payments are held by a licensed payment partner and released to the seller only after delivery is confirmed.
            </p>
          </div>
          <div>
            <Truck className="h-8 w-8 text-ocean-700" aria-hidden />
            <h3 className="mt-3 text-lg font-semibold">One record, end to end</h3>
            <p className="mt-1 text-muted-foreground">Payment, shipping, customs and delivery all tracked under a single IIE transaction ID.</p>
          </div>
        </div>
      </section>
    </>
  );
}
