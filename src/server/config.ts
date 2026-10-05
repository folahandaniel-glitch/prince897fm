import { z } from 'zod';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import type { Q } from './db';
import {
  brandingSchema, contrastRatio, DEFAULT_BRANDING, DEFAULT_NAV, DEFAULT_TERMS, navigationSchema, terminologySchema,
  type Branding, type Navigation, type Terminology,
} from '../domain/config-schema';

export type ConfigKind = 'branding' | 'terminology' | 'navigation';

const schemas: Record<ConfigKind, z.ZodType<any>> = { branding: brandingSchema, terminology: terminologySchema, navigation: navigationSchema };

// Published config changes rarely and is read on every request: keep it in memory for a few seconds per instance.
// Publishing invalidates the local entry immediately; other instances converge within the TTL.
const TTL_MS = 15_000;
const cache = new Map<string, { at: number; value: { branding: Branding; terms: Terminology; nav: Navigation } }>();
export const invalidateConfig = (orgId: string) => cache.delete(orgId);

export async function resolveConfig(q: Q, orgId?: string): Promise<{ branding: Branding; terms: Terminology; nav: Navigation }> {
  const hit = orgId ? cache.get(orgId) : undefined;
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const rows = await q.query<{ kind: ConfigKind; payload: any }>(`select kind, payload from config_versions where status = 'published'`);
  const by = Object.fromEntries(rows.map((r) => [r.kind, r.payload]));
  const value = {
    branding: { ...DEFAULT_BRANDING, ...(by.branding ?? {}) } as Branding,
    terms: { ...DEFAULT_TERMS, ...(by.terminology ?? {}) } as Terminology,
    nav: (by.navigation ?? DEFAULT_NAV) as Navigation,
  };
  if (orgId) cache.set(orgId, { at: Date.now(), value });
  return value;
}

function validate(kind: ConfigKind, payload: unknown) {
  const parsed = schemas[kind].safeParse(payload);
  if (!parsed.success) throw new UserError(parsed.error.issues.map((i) => `${i.path.join('.') || kind}: ${i.message}`).join('; '));
  if (kind === 'branding') {
    const b = parsed.data as Branding;
    if (contrastRatio(b.primary, '#ffffff') < 4.5) throw new UserError('Primary colour is too light: white text on it must reach a contrast ratio of at least 4.5:1 (WCAG AA).');
    if (contrastRatio(b.secondary, '#ffffff') < 3) throw new UserError('Secondary colour is too light for readable use (minimum contrast 3:1 on white).');
  }
  return parsed.data;
}

export async function saveDraft(c: Ctx, kind: ConfigKind, payload: unknown, note?: string) {
  need(c, 'config:manage');
  const data = validate(kind, payload);
  await c.q.query(`delete from config_versions where kind = $1 and status = 'draft'`, [kind]);
  const [{ v }] = await c.q.query<{ v: number }>('select coalesce(max(version),0)+1 as v from config_versions where kind = $1', [kind]);
  await c.q.query(`insert into config_versions (org_id, kind, version, status, payload, note, created_by) values ($1,$2,$3,'draft',$4::jsonb,$5,$6)`,
    [c.orgId, kind, v, JSON.stringify(data), note ?? null, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'config.draft_saved', entity: `config:${kind}`, after: { version: v }, ip: c.ip, userAgent: c.userAgent });
  return v;
}

export async function publishDraft(c: Ctx, kind: ConfigKind, note?: string) {
  need(c, 'config:manage');
  const draft = await c.q.query<{ id: string; version: number; payload: unknown }>(`select id, version, payload from config_versions where kind = $1 and status = 'draft'`, [kind]);
  if (!draft[0]) throw new UserError('There is no draft to publish.');
  validate(kind, draft[0].payload); // re-validate: schemas may have tightened since the draft was saved
  const before = await c.q.query<{ version: number }>(`select version from config_versions where kind = $1 and status = 'published'`, [kind]);
  await c.q.query(`update config_versions set status = 'superseded' where kind = $1 and status = 'published'`, [kind]);
  await c.q.query(`update config_versions set status = 'published', published_at = now(), note = coalesce($2, note) where id = $1`, [draft[0].id, note ?? null]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'config.published', entity: `config:${kind}`, before: { version: before[0]?.version ?? null }, after: { version: draft[0].version }, reason: note, ip: c.ip, userAgent: c.userAgent });
  invalidateConfig(c.orgId);
}

export async function rollbackTo(c: Ctx, kind: ConfigKind, versionId: string, reason: string) {
  need(c, 'config:rollback');
  if (!reason.trim()) throw new UserError('A reason is required to roll back configuration.');
  const old = await c.q.query<{ payload: unknown; version: number }>('select payload, version from config_versions where id = $1 and kind = $2', [versionId, kind]);
  if (!old[0]) throw new UserError('Version not found.');
  const data = validate(kind, old[0].payload);
  const [{ v }] = await c.q.query<{ v: number }>('select coalesce(max(version),0)+1 as v from config_versions where kind = $1', [kind]);
  await c.q.query(`update config_versions set status = 'superseded' where kind = $1 and status = 'published'`, [kind]);
  await c.q.query(`insert into config_versions (org_id, kind, version, status, payload, note, created_by, published_at) values ($1,$2,$3,'published',$4::jsonb,$5,$6, now())`,
    [c.orgId, kind, v, JSON.stringify(data), `Rollback to v${old[0].version}: ${reason}`, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'config.rolled_back', entity: `config:${kind}`, after: { toVersion: old[0].version, newVersion: v }, reason, ip: c.ip, userAgent: c.userAgent });
  invalidateConfig(c.orgId);
}

export async function configHistory(q: Q, kind: ConfigKind) {
  return q.query<any>('select id, version, status, note, created_at, published_at from config_versions where kind = $1 order by version desc limit 20', [kind]);
}

export async function getDraft<T>(q: Q, kind: ConfigKind): Promise<T | null> {
  const r = await q.query<{ payload: T }>(`select payload from config_versions where kind = $1 and status = 'draft'`, [kind]);
  return r[0]?.payload ?? null;
}
