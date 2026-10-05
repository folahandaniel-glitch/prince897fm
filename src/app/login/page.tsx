import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { login, SESSION_COOKIE } from '@/server/auth';
import { boot } from '@/server/session';
import { privileged } from '@/server/db';
import { DEFAULT_BRANDING, hexToRgbTriplet, type Branding } from '@/domain/config-schema';
import { LoginForm } from './form';

export const metadata = { title: 'Sign in' };
// Statically generated and refreshed in the background: the sign-in page opens instantly from the edge cache.
export const revalidate = 120;

async function signIn(_prev: { error?: string } | null, data: FormData): Promise<{ error?: string } | null> {
  'use server';
  await boot();
  const h = await headers();
  const res = await login(
    String(data.get('org') ?? ''), String(data.get('email') ?? ''), String(data.get('password') ?? ''),
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null, h.get('user-agent'),
  );
  if (!res.ok) return { error: res.error };
  (await cookies()).set(SESSION_COOKIE, res.token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: res.maxAgeSec });
  redirect(res.mfaRequired ? '/login/mfa' : '/dashboard');
}

/** Branding of the tenant that owns this deployment's sign-in page (DEFAULT_ORG_SLUG). Falls back to neutral defaults. */
async function loginBranding(): Promise<{ b: Branding; slug: string }> {
  const slug = process.env.DEFAULT_ORG_SLUG ?? 'prince897';
  try {
    if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'production' && process.env.SEED_DEMO !== 'force') return { b: DEFAULT_BRANDING, slug: '' };
    await boot();
    const r = await (await privileged()).query<{ payload: Branding }>(
      `select c.payload from config_versions c join organizations o on o.id = c.org_id where o.slug = $1 and c.kind = 'branding' and c.status = 'published'`, [slug]);
    return r[0] ? { b: { ...DEFAULT_BRANDING, ...r[0].payload }, slug } : { b: DEFAULT_BRANDING, slug: '' };
  } catch {
    return { b: DEFAULT_BRANDING, slug: '' };
  }
}

export default async function LoginPage() {
  const { b, slug } = await loginBranding();
  return (
    <main id="main" className="grid min-h-screen place-items-center bg-[#0b0b0b] p-4" style={{ ['--brand' as string]: hexToRgbTriplet(b.primary), ['--accent' as string]: hexToRgbTriplet(b.accent), ['--brand-2' as string]: hexToRgbTriplet(b.secondary) }}>
      <div className="w-full max-w-md">
        {b.logoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={b.logoUrl} alt={b.name} width={400} height={110} fetchPriority="high" className="mx-auto mb-6 h-auto w-full max-w-xs" />
          : <h1 className="mb-6 text-center text-3xl font-bold text-white">{b.name}</h1>}
        <div className="card" style={{ borderTop: `4px solid ${b.accent}` }}>
          <h1 className="text-2xl font-bold">Staff sign in</h1>
          <p className="mt-1 text-sm text-muted">{b.tagline || 'Enter your organisation code, email and password.'}</p>
          <LoginForm action={signIn} defaultOrg={slug} />
          <p className="mt-4 text-sm"><a className="underline" href="/forgot">Forgot your password?</a></p>
          <p className="mt-2 text-sm text-muted">New here? Ask HR for the registration link.</p>
        </div>
        <p className="mt-4 text-center text-xs text-white/60">{b.footer}</p>
      </div>
    </main>
  );
}
