import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { Providers } from '@/lib/session';
import './globals.css';

/** Set at build time for non-production sites (e.g. "Staging"); shows a banner on every page. */
const ENVIRONMENT_LABEL = process.env.NEXT_PUBLIC_ENVIRONMENT_LABEL;

export const metadata: Metadata = {
  title: { default: 'Inter-Island Exchange', template: '%s | Inter-Island Exchange' },
  description: 'A secure digital marketplace connecting buyers and sellers across CARICOM.',
  // Test sites stay out of search engines.
  ...(ENVIRONMENT_LABEL ? { robots: { index: false, follow: false } } : {}),
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0e7490' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col font-sans">
        <Providers>
          <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">
            Skip to content
          </a>
          {ENVIRONMENT_LABEL && (
            <p className="bg-coral-500 px-4 py-1 text-center text-sm font-semibold text-white" role="note">
              {ENVIRONMENT_LABEL} · test site: payments use a sandbox and no real money moves
            </p>
          )}
          <SiteHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
