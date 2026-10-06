

import path from 'node:path';

// The Content-Security-Policy is set per request in src/middleware.ts (it carries a fresh script nonce).

const config = {
  serverExternalPackages: ['@electric-sql/pglite', 'postgres'],
  poweredByHeader: false,
  // Uploads (documents up to 5 MB, logos, bank statements) arrive through server actions; the default limit is 1 MB.
  experimental: { serverActions: { bodySizeLimit: '6mb' } },
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
