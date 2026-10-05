import { cookies } from 'next/headers';
import { resolveSession, SESSION_COOKIE } from '@/server/auth';
import { boot } from '@/server/session';
import { withTenant } from '@/server/db';
import { resolveConfig } from '@/server/config';
import { DEFAULT_BRANDING } from '@/domain/config-schema';

export const dynamic = 'force-dynamic';

/** Web App Manifest generated per tenant so the installed app carries the organisation's name and colours. */
export async function GET() {
  await boot();
  let b = DEFAULT_BRANDING;
  const s = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (s) b = (await withTenant(s.org_id, (q) => resolveConfig(q, s.org_id))).branding;
  const q = `?c=${encodeURIComponent(b.primary)}`;
  const body = {
    id: '/', name: b.name, short_name: b.shortName, description: b.tagline || `${b.name} workspace`,
    start_url: '/dashboard', scope: '/', display: 'standalone', orientation: 'any',
    theme_color: b.primary, background_color: '#ffffff', lang: 'en',
    icons: b.iconBase
      ? [
          { src: `${b.iconBase}-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${b.iconBase}-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${b.iconBase}-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ]
      : [
          { src: `/icons/192${q}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `/icons/512${q}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `/icons/512${q}&m=1`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
    shortcuts: [{ name: 'Dashboard', url: '/dashboard' }, { name: 'Employees', url: '/employees' }],
  };
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'private, max-age=0, must-revalidate' } });
}
