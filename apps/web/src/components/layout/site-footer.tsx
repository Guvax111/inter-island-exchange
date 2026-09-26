import Link from 'next/link';
import { PRIMARY_NAV } from '@/lib/navigation';

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t bg-ocean-900 text-ocean-50">
      <div className="container grid gap-8 py-10 md:grid-cols-3">
        <div>
          <p className="text-lg font-semibold">Inter-Island Exchange, Inc.</p>
          <p className="mt-2 text-sm text-ocean-100">A secure digital marketplace connecting buyers and sellers across CARICOM.</p>
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
