import dns from 'node:dns/promises';
import net from 'node:net';

export interface CheckStep { name: string; ok: boolean; note: string }
export interface CheckReport { provider: string; steps: CheckStep[]; hint: string }

/** Cleans a pasted DATABASE_URL: stray quotes/spaces, a leading "psql", and parameters the driver does not understand. */
export function normalizeDbUrl(raw: string): string {
  let s = raw.trim();
  const m = /postgres(?:ql)?:\/\/[^\s'"]+/i.exec(s);
  if (m) s = m[0];
  s = s.replace(/^['"]|['"]$/g, '');
  try {
    const u = new URL(s);
    u.searchParams.delete('channel_binding'); // Neon adds this; the driver cannot send it and poolers reject it
    const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
    if (!local && !u.searchParams.has('sslmode')) u.searchParams.set('sslmode', 'require');
    return u.toString();
  } catch {
    return s;
  }
}

function providerOf(host: string): string {
  if (/neon\.tech$/i.test(host)) return /-pooler\./i.test(host) ? 'Neon (pooled connection)' : 'Neon (direct connection)';
  if (/pooler\.supabase\.com$/i.test(host)) return 'Supabase (pooler)';
  if (/supabase\.co$/i.test(host)) return 'Supabase (direct connection)';
  if (/rds\.amazonaws\.com$/i.test(host)) return 'Amazon RDS';
  if (/vercel-storage\.com$/i.test(host)) return 'Vercel Postgres';
  return 'your database provider';
}

/** Walks the connection step by step so the owner can see exactly where it fails. Never returns the URL, host name or password. */
export async function checkDatabase(rawUrl: string | undefined): Promise<CheckReport> {
  const steps: CheckStep[] = [];
  if (!rawUrl?.trim()) return { provider: 'none', steps, hint: 'DATABASE_URL is empty. Add it in Vercel → Settings → Environment Variables, then redeploy.' };
  let u: URL;
  try { u = new URL(normalizeDbUrl(rawUrl)); } catch { return { provider: 'unknown', steps: [{ name: 'Read the connection string', ok: false, note: 'It is not a valid address. It should start with postgresql:// and contain user, password, host and database name.' }], hint: 'Copy the whole connection string again from your database provider.' }; }
  const provider = providerOf(u.hostname);
  const port = Number(u.port || 5432);
  steps.push({ name: 'Read the connection string', ok: true, note: `${provider}, port ${port}, ${u.searchParams.get('sslmode') === 'require' ? 'secure connection' : 'plain connection'}` });
  let addrs: { address: string; family: number }[] = [];
  try {
    addrs = await dns.lookup(u.hostname, { all: true });
    steps.push({ name: 'Find the database on the internet', ok: true, note: `found (${[...new Set(addrs.map((a) => 'IPv' + a.family))].join(' and ')})` });
  } catch {
    steps.push({ name: 'Find the database on the internet', ok: false, note: 'the host name does not exist' });
    return { provider, steps, hint: 'The host name in DATABASE_URL looks wrong or the project was deleted. Copy the connection string again.' };
  }
  const tcp = await new Promise<string | null>((resolve) => {
    const s = net.connect({ host: u.hostname, port, timeout: 6000, family: addrs.some((a) => a.family === 4) ? 4 : 6 });
    s.once('connect', () => { s.destroy(); resolve(null); });
    s.once('timeout', () => { s.destroy(); resolve('no answer within 6 seconds'); });
    s.once('error', (e: NodeJS.ErrnoException) => { s.destroy(); resolve(e.code ?? 'connection failed'); });
  });
  steps.push({ name: 'Reach the database server', ok: !tcp, note: tcp ? `failed (${tcp})` : 'reachable' });
  if (tcp) {
    const v6only = addrs.length > 0 && addrs.every((a) => a.family === 6);
    return { provider, steps, hint: v6only || /supabase\.co$/i.test(u.hostname) && !/pooler/.test(u.hostname)
      ? 'This address only works over IPv6, which Vercel cannot use. In Supabase use the "Transaction pooler" connection string (host ends in pooler.supabase.com) instead.'
      : 'The server cannot be reached. If you use Neon, open the project once in the Neon console so it wakes up, check the project is not suspended, and make sure no IP allow-list blocks Vercel.' };
  }
  return { provider, steps, hint: 'The server is reachable, so the problem is the sign-in or the database itself. See the technical detail below.' };
}
