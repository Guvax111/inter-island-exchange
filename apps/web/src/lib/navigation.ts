/**
 * Primary navigation required by the IIE brief. `status` drives what users see: sections not yet built
 * go to a clearly labelled "Coming soon" page (tracked in docs/MOCK_FUNCTIONALITY_AUDIT.md).
 */
export interface NavItem {
  label: string;
  href: string;
  status: 'live' | 'coming-soon';
}

export const PRIMARY_NAV: NavItem[] = [
  { label: 'Home', href: '/', status: 'live' },
  { label: 'Marketplace', href: '/marketplace', status: 'coming-soon' },
  { label: 'How It Works', href: '/how-it-works', status: 'live' },
  { label: 'Buy', href: '/buy', status: 'live' },
  { label: 'Sell', href: '/sell', status: 'live' },
  { label: 'Countries', href: '/countries', status: 'live' },
  { label: 'Logistics', href: '/logistics', status: 'coming-soon' },
  { label: 'Payment & Transaction Security', href: '/payment-security', status: 'live' },
  { label: 'Business Solutions', href: '/business-solutions', status: 'coming-soon' },
  { label: 'Help Center', href: '/help', status: 'coming-soon' },
  { label: 'About IIE', href: '/about', status: 'live' },
  { label: 'Contact', href: '/contact', status: 'coming-soon' },
];

export const COMING_SOON: Record<string, { title: string; phase: string; summary: string }> = {
  marketplace: { title: 'Marketplace', phase: 'Phase 2', summary: 'Browse and search products from verified sellers across CARICOM.' },
  logistics: { title: 'Logistics', phase: 'Phase 5', summary: 'Pickup, regional shipping and last-mile delivery through IIE logistics partners.' },
  'business-solutions': { title: 'Business Solutions', phase: 'Phase 7', summary: 'Tools for business buyers and sellers trading at volume.' },
  help: { title: 'Help Center', phase: 'Phase 7', summary: 'Guides and answers for buyers, sellers and partners.' },
  contact: { title: 'Contact', phase: 'before launch', summary: 'Ways to reach the IIE team.' },
  track: { title: 'Track a Shipment', phase: 'Phase 5', summary: 'Follow every shipment from pickup to delivery with its IIE transaction ID.' },
};
