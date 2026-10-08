import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { emailConfigured, flushOutbox, smsConfigured } from './messaging';
import { resolveSession, SESSION_COOKIE } from './auth';
import { loadSubject, runAs, UserError, type Ctx } from './ctx';
import { withTenant } from './db';
import { ensureDatabase } from './db';
import { resolveConfig } from './config';
import { navExtras } from './builders';
import { activeAnnouncements } from './calendar';
import { autoCloseThrottled } from './attendance';
import { seedDemoIfEmpty } from './seed';
import { ForbiddenError, can } from '../domain/policy';
import type { Branding, Navigation, Terminology } from '../domain/config-schema';

let booted: Promise<void> | null = null;
export function boot() {
  const p = (booted ??= (async () => { await ensureDatabase(); await seedDemoIfEmpty(); })());
  p.catch(() => { if (booted === p) booted = null; }); // do not remember a failed start: retry on the next request
  return p;
}

export interface Page {
  ctx: Ctx;
  email: string;
  org: { id: string; slug: string; name: string; timezone: string; currency: string; locale: string };
  branding: Branding; terms: Terminology; nav: Navigation;
  unread: number;
  allowed: (action: string) => boolean;
  /** Module switch from the BackEnd. A disabled module disappears from navigation and its pages return 404. */
  feature: (key: string) => boolean;
  platformAdmin: boolean;
  requireFeature: (key: string) => void;
}

async function requestMeta() {
  const h = await headers();
  return { ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null, userAgent: h.get('user-agent') };
}

/**
 * Per-request shell data (session, permissions, branding, unread count). Memoised with React's request-scoped cache so the
 * layout and the page share ONE lookup instead of each repeating it.
 */
const loadShell = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value; // reading cookies first marks the page dynamic, so it is never prerendered at build time
  await boot();
  const s = await resolveSession(token);
  if (!s) return null;
  const shell = await withTenant(s.org_id, async (q) => {
    if (await autoCloseThrottled(q, s.org_id, s.user_id)) return null; // forgot to clock out: the shift was closed and this person was signed out
    const photo = (await q.query<{ sha256: string }>('select sha256 from user_photos where user_id = $1', [s.user_id]))[0]?.sha256 ?? null;
    const [subject, cfg, unread, off, extras] = await Promise.all([
      loadSubject(q, s.org_id, s.user_id),
      resolveConfig(q, s.org_id),
      q.query<{ n: number }>('select count(*)::int n from notifications where user_id = $1 and read_at is null', [s.user_id]),
      q.query<{ key: string }>('select key from org_features where not enabled'),
      navExtras(q, s.org_id),
    ]);
    const ann = (await activeAnnouncements({ q, orgId: s.org_id, userId: s.user_id, subject } as Ctx)).map((a: any) => ({ id: a.id as string, title: a.title as string, body: a.body as string, pinned: !!a.pinned, when: String(a.created_at) }));
    return { subject, cfg, unread: unread[0].n, disabled: new Set(off.map((r) => r.key)), extras, announcements: ann, photo };
  }, s.user_id);
  if (!shell) return null;
  return { s, ...shell };
});

export type Shell = NonNullable<Awaited<ReturnType<typeof loadShell>>>;

export async function shell(opts: { allowPasswordChange?: boolean } = {}): Promise<Shell> {
  const sh = await loadShell();
  if (!sh) redirect('/login');
  if (sh.s.must_change_password && !opts.allowPasswordChange) redirect('/account/password'); // one-time passwords must be replaced first
  return sh;
}

/** Run a page's data access as the signed-in user inside one tenant-bound transaction. */
export async function page<T>(fn: (p: Page) => Promise<T>): Promise<T> {
  const sh = await shell();
  const { s } = sh;
  const meta = await requestMeta();
  try {
    return await withTenant(s.org_id, (q) => {
      const ctx: Ctx = { q, orgId: s.org_id, userId: s.user_id, subject: sh.subject, ...meta };
      return fn({
        ctx, email: s.email, branding: sh.cfg.branding, terms: sh.cfg.terms, nav: sh.cfg.nav, unread: sh.unread,
        org: { id: s.org_id, slug: s.org_slug, name: s.org_name, timezone: s.timezone, currency: s.currency, locale: s.locale },
        allowed: (a) => can(sh.subject, a).allow,
        feature: (k) => !sh.disabled.has(k),
        platformAdmin: !!s.platform_admin,
        requireFeature: (k) => { if (sh.disabled.has(k)) notFound(); },
      });
    }, s.user_id);
  } catch (e) {
    if (e instanceof ForbiddenError) redirect('/forbidden');
    throw e;
  }
}

export type FormState = { ok?: string; error?: string } | null;

/** Wrap a mutation: runs as the current user, converts expected errors to messages, revalidates affected paths. */
export async function mutate(paths: string[], fn: (ctx: Ctx) => Promise<string | void>): Promise<FormState> {
  await boot();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const s = await resolveSession(token);
  if (!s) redirect('/login');
  try {
    const msg = await runAs(s.org_id, s.user_id, fn, await requestMeta());
    for (const p of paths) revalidatePath(p);
    if (emailConfigured() || smsConfigured()) after(() => flushOutbox().catch(() => {})); // deliver queued messages right after responding; cron is the backstop
    return { ok: msg || 'Saved.' };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    if (e instanceof ForbiddenError) return { error: `Not permitted: ${e.message}` };
    console.error('[mutation failed]', e);
    return { error: 'Something went wrong. Nothing was changed. Please try again.' };
  }
}

export const field = (f: FormData, k: string) => (f.get(k)?.toString() ?? '').trim();
export const optional = (f: FormData, k: string) => field(f, k) || null;
