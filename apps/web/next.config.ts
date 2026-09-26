import type { NextConfig } from 'next';

/** Server-side address of the API. The browser never calls it directly: /api/v1/* is proxied so cookies stay first-party. */
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://127.0.0.1:4000';

const securityHeaders = [
  // Verification and reset links carry tokens in the URL; never leak them via Referer.
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_ORIGIN}/api/v1/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
