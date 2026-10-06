import { DEFAULT_BRANDING, type Branding } from '../domain/config-schema';
import { privileged } from './db';
import { boot } from './session';

let cache: { at: number; v: { b: Branding; slug: string } } | null = null; // pages render per request (CSP nonce), so keep the tenant lookup off the hot path

/** Branding of the organisation that owns this deployment's public pages (DEFAULT_ORG_SLUG). Falls back to neutral defaults, never throws. */
export async function publicBranding(): Promise<{ b: Branding; slug: string }> {
  if (cache && Date.now() - cache.at < 60_000) return cache.v;
  const v = await load();
  if (v.slug) cache = { at: Date.now(), v };
  return v;
}

async function load(): Promise<{ b: Branding; slug: string }> {
  const slug = process.env.DEFAULT_ORG_SLUG ?? 'prince897';
  // The build must never wait on (or write to) a database.
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
