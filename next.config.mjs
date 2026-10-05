

import path from 'node:path';

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'", // TODO(security): move to per-request nonces (tracked in KNOWN_GAPS.md)
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const config = {
  serverExternalPackages: ['@electric-sql/pglite', 'postgres'],
  poweredByHeader: false,
  webpack(config) {
    config.resolve.alias['@'] = path.join(process.cwd(), 'src');
    return config;
  },
  async headers() {
    return [
      { source: '/(brand|icons)/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      {
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: csp },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(self), microphone=()' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    },
    ];
  },
};
export default config;
