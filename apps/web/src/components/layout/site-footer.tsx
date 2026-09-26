import Link from 'next/link';
import { CONTACT, PRIMARY_NAV } from '@/lib/navigation';

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t bg-ocean-900 text-ocean-50">
      <div className="container grid gap-8 py-10 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/iie-mark.png" alt="" width={48} height={48} className="h-12 w-12 rounded-full bg-white p-1" />
            <p className="text-lg font-semibold">Inter-Island Exchange, Inc.</p>
          </div>
          <p className="mt-2 text-sm text-ocean-100">A secure digital marketplace connecting buyers and sellers across CARICOM.</p>
          <address className="mt-4 space-y-1 text-sm not-italic text-ocean-100">
            <p>{CONTACT.address}</p>
            <p>
              <a href={`mailto:${CONTACT.email}`} className="hover:text-white">{CONTACT.email}</a>
            </p>
            <p>
              <a href={`tel:${CONTACT.phoneE164}`} className="hover:text-white">{CONTACT.phone}</a>
            </p>
          </address>
        </div>
        <ul className="grid grid-cols-2 gap-2 text-sm md:col-span-2 md:grid-cols-3">
          {PRIMARY_NAV.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="text-ocean-100 hover:text-white">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="border-t border-ocean-800 py-4 text-center text-xs text-ocean-100">
        © {new Date().getFullYear()} Inter-Island Exchange, Inc. Pilot: St. Lucia → St. Vincent and the Grenadines.
      </div>
    </footer>
  );
}
