/**
 * Primary navigation required by the IIE brief. `status` drives what users see: sections not yet built
 * go to a clearly labelled "Coming soon" page (tracked in docs/MOCK_FUNCTIONALITY_AUDIT.md).
 */
export interface NavItem {
  label: string;
  href: string;
  status: 'live' | 'coming-soon';
}

/** IIE's official contact details. */
export const CONTACT = {
  address: 'Arnos Vale, St. Vincent and the Grenadines',
  email: 'info@interislandexchange.com',
  phone: '(347) 497-3977',
  phoneE164: '+13474973977',
};

export const PRIMARY_NAV: NavItem[] = [
  { label: 'Home', href: '/', status: 'live' },
  { label: 'Marketplace', href: '/marketplace', status: 'live' },
  { label: 'How It Works', href: '/how-it-works', status: 'live' },
  { label: 'Buy', href: '/buy', status: 'live' },
  { label: 'Sell', href: '/sell', status: 'live' },
  { label: 'Countries', href: '/countries', status: 'live' },
  { label: 'Logistics', href: '/logistics', status: 'live' },
  { label: 'Payment & Transaction Security', href: '/payment-security', status: 'live' },
  { label: 'Duties & Tariffs', href: '/tariffs', status: 'live' },
  { label: 'Business Solutions', href: '/business-solutions', status: 'coming-soon' },
  { label: 'Help Center', href: '/help', status: 'live' },
  { label: 'About IIE', href: '/about', status: 'live' },
  { label: 'Contact', href: '/contact', status: 'live' },
];

export const COMING_SOON: Record<string, { title: string; phase: string; summary: string }> = {
  'business-solutions': { title: 'Business Solutions', phase: 'a later phase', summary: 'Tools for business buyers and sellers trading at volume.' },
};
