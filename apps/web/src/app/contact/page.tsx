import Link from 'next/link';
import { Clock, Mail, MapPin, Phone } from 'lucide-react';
import { CONTACT } from '@/lib/navigation';

export const metadata = { title: 'Contact' };

export default function ContactPage() {
  const items = [
    { icon: MapPin, label: 'Office', value: CONTACT.address, href: null },
    { icon: Mail, label: 'Email', value: CONTACT.email, href: `mailto:${CONTACT.email}` },
    { icon: Phone, label: 'Phone', value: CONTACT.phone, href: `tel:${CONTACT.phoneE164}` },
    { icon: Clock, label: 'Support hours', value: CONTACT.hours, href: null },
  ];
  return (
    <section className="container max-w-3xl py-12">
      <h1 className="text-3xl font-bold text-ocean-900">Contact Inter-Island Exchange</h1>
      <p className="mt-3 text-lg text-muted-foreground">Questions about buying, selling or partnering with IIE? We are happy to help.</p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {items.map(({ icon: Icon, label, value, href }) => (
          <li key={label} className="rounded-lg border p-5">
            <Icon className="h-6 w-6 text-palm-600" aria-hidden />
            <p className="mt-3 text-sm font-medium text-muted-foreground">{label}</p>
            {href ? (
              <a href={href} className="mt-1 block break-words font-semibold text-ocean-800 underline-offset-2 hover:underline">
                {value}
              </a>
            ) : (
              <p className="mt-1 font-semibold text-ocean-800">{value}</p>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-8 text-sm text-muted-foreground">
        Already have an order? Include your IIE transaction ID (for example IIE-SLU-SVG-000001) so we can find it quickly. Sellers can also
        reach us from their <Link href="/dashboard/seller" className="underline">seller dashboard</Link>.
      </p>
    </section>
  );
}
