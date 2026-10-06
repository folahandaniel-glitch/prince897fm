import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { login, resolveSession, SESSION_COOKIE } from '@/server/auth';
import { boot } from '@/server/session';
import { privileged } from '@/server/db';
import { DEFAULT_BRANDING, hexToRgbTriplet, type Branding } from '@/domain/config-schema';
import { Icon } from '@/components/icons';
import { LoginForm } from './form';
import { AuthScene } from './scene';

export const dynamic = 'force-dynamic'; // rendered per request so every script can carry the request's CSP nonce
export const metadata = { title: 'Sign in' };

/** Only same-site, known destinations: never an open redirect. */
const safeNext = (v: unknown) => (typeof v === 'string' && /^\/(backend|dashboard)(\/[a-z0-9\-/]*)?$/.test(v) ? v : '/dashboard');

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
  const dest = safeNext(data.get('next'));
  // MFA users finish on another page, so remember where they were heading for a few minutes.
  if (res.mfaRequired) { (await cookies()).set('ws_next', dest, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/login', maxAge: 600 }); redirect('/login/mfa'); }
  redirect(dest);
}

let brandCache: { at: number; v: { b: Branding; slug: string } } | null = null; // the page renders per request (CSP nonce), so keep the tenant lookup off the hot path
async function loginBranding(): Promise<{ b: Branding; slug: string }> {
  if (brandCache && Date.now() - brandCache.at < 60_000) return brandCache.v;
  const v = await loadLoginBranding();
  if (v.slug) brandCache = { at: Date.now(), v };
  return v;
}

/** Branding of the tenant that owns this deployment's sign-in page (DEFAULT_ORG_SLUG). Falls back to neutral defaults. */
async function loadLoginBranding(): Promise<{ b: Branding; slug: string }> {
  const slug = process.env.DEFAULT_ORG_SLUG ?? 'prince897';
  // The build must never wait on (or write to) a database: it renders with neutral defaults, and the page refreshes with the tenant's branding at runtime.
  if (process.env.NEXT_PHASE === 'phase-production-build') return { b: DEFAULT_BRANDING, slug };
  try {
    if (!(process.env.DATABASE_URL || process.env.POSTGRES_URL) && process.env.NODE_ENV === 'production' && process.env.SEED_DEMO !== 'force') return { b: DEFAULT_BRANDING, slug: '' };
    await boot();
    const r = await (await privileged()).query<{ payload: Branding }>(
      `select c.payload from config_versions c join organizations o on o.id = c.org_id where o.slug = $1 and c.kind = 'branding' and c.status = 'published'`, [slug]);
    return r[0] ? { b: { ...DEFAULT_BRANDING, ...r[0].payload }, slug } : { b: DEFAULT_BRANDING, slug: '' };
  } catch {
    return { b: DEFAULT_BRANDING, slug: '' };
  }
}

const FEATURES: [string, string, string][] = [
  ['clock', 'Attendance & shifts', 'Geofenced clock-in, rosters and leave'],
  ['wallet', 'Payslips', 'View and print your pay, with every deduction explained'],
  ['doc', 'Reports & approvals', 'Weekly and monthly reports with a clear approval trail'],
  ['shield', 'Private by design', 'Your records are visible only to those who need them'],
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { b, slug } = await loginBranding();
  const next = safeNext((await searchParams).next);
  const backend = next.startsWith('/backend');
  // Already signed in (for example following the footer BackEnd link): go straight there.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) { await boot(); if (await resolveSession(token)) redirect(next); }
  const vars = { ['--brand' as string]: hexToRgbTriplet(b.primary), ['--accent' as string]: hexToRgbTriplet(b.accent), ['--brand-2' as string]: hexToRgbTriplet(b.secondary) };
  return (
    <main id="main" className="grid min-h-screen bg-[#0b0b0b] lg:grid-cols-[1.1fr_1fr]" style={vars}>
      {/* Brand panel */}
      <section className="auth-hero flex flex-col justify-between px-6 py-8 text-white sm:px-10 lg:min-h-screen lg:px-14 lg:py-12" aria-label={b.name}>
        <div className="auth-orb a" aria-hidden /><div className="auth-orb b" aria-hidden />
        <div className="relative z-10 flex items-center justify-between gap-4">
          {b.logoUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={b.logoUrl} alt={b.name} width={400} height={110} fetchPriority="high" className="h-auto w-48 max-w-full sm:w-60" />
            : <p className="text-2xl font-bold tracking-tight">{b.name}</p>}
          <span className="auth-eq" aria-hidden><i /><i /><i /><i /><i /></span>
        </div>
        <div className="relative z-10 my-4 lg:my-2"><AuthScene photo="/brand/chairman.webp" /></div>
        <div className="relative z-10 my-6 max-w-xl lg:my-0">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-white/70">Staff workspace</p>
          <h1 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">Welcome back<span className="text-[rgb(var(--accent))]">.</span></h1>
          <p className="mt-3 max-w-md text-base text-white/80 sm:text-lg">{b.tagline || 'Everything you need for work, in one secure place.'}</p>
          <ul className="mt-8 hidden gap-3 sm:grid sm:grid-cols-2" aria-label="What you can do here">
            {FEATURES.map(([icon, title, sub]) => (
              <li key={title} className="auth-chip"><span className="ico"><Icon name={icon} /></span><span><span className="block text-sm font-semibold">{title}</span><span className="block text-xs text-white/65">{sub}</span></span></li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 hidden text-xs text-white/50 lg:block">{b.name} · Encrypted connection · Every sign-in and change is recorded</p>
      </section>

      {/* Form panel */}
      <section className="auth-panel flex flex-col justify-center px-6 py-10 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-md">
          <h2 className="text-3xl font-bold text-white">{backend ? 'BackEnd sign in' : 'Sign in'}</h2>
          <p className="mt-1 text-sm text-slate-400">{backend ? 'This is the control centre for the Super Administrator. Sign in with your Super Admin email and password: after that you go straight to the BackEnd.' : 'Use the organisation code, email and password you were given.'}</p>
          {backend && <p className="mt-3 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-slate-300">Not a Super Administrator? <a className="underline" href="/login">Use the normal staff sign in</a>.</p>}
          <LoginForm action={signIn} defaultOrg={slug} next={next} />
          <p className="mt-6 text-sm text-slate-400">New here? Ask HR for your registration link.</p>
          <div className="mt-10 border-t border-white/10 pt-5 text-center">
            <p className="text-xs text-slate-400">{b.footer}</p>
            <p className="mt-1"><a href="/login?next=/backend" className="inline-block px-2 py-1 text-[10px] uppercase tracking-widest text-slate-400 hover:text-white hover:underline">BackEnd</a></p>
          </div>
        </div>
      </section>
    </main>
  );
}
