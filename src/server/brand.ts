import crypto from 'node:crypto';
import type { Branding } from '../domain/config-schema';
import { audit } from './audit';
import { getDraft, resolveConfig, saveDraft } from './config';
import { need, UserError, type Ctx } from './ctx';
import { privileged } from './db';

export type BrandKind = 'logo' | 'mark';
const MAX = 1024 * 1024;

/** Identify by content, not by file name or the browser's claim. SVG is deliberately not accepted. */
export function sniffImage(b: Buffer): { mime: 'image/png' | 'image/jpeg' | 'image/webp' } | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png' };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg' };
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp' };
  return null;
}

/** Stores the image and points the branding draft at it. The change goes live when the draft is published. */
export async function saveBrandImage(c: Ctx, kind: BrandKind, data: Buffer) {
  need(c, 'config:manage');
  if (!['logo', 'mark'].includes(kind)) throw new UserError('Unknown image type.');
  if (data.length === 0) throw new UserError('Choose an image file.');
  if (data.length > MAX) throw new UserError('That image is larger than 1 MB. Export a smaller version (a logo rarely needs more than 800 pixels wide).');
  const t = sniffImage(data);
  if (!t) throw new UserError('Use a PNG, JPEG or WebP image. SVG files are not accepted.');
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  await c.q.query(`insert into org_assets (org_id, kind, mime, bytes, sha256, updated_by) values ($1,$2,$3,$4,$5,$6)
    on conflict (org_id, kind) do update set mime = excluded.mime, bytes = excluded.bytes, sha256 = excluded.sha256, updated_by = excluded.updated_by, updated_at = now()`, [c.orgId, kind, t.mime, data, sha, c.userId]);
  const slug = (await c.q.query<{ slug: string }>('select slug from organizations where id = $1', [c.orgId]))[0].slug;
  const base = (await getDraft<Branding>(c.q, 'branding')) ?? (await resolveConfig(c.q, c.orgId)).branding;
  const url = `/api/brand/${slug}/${kind}?v=${sha.slice(0, 10)}`;
  await saveDraft(c, 'branding', { ...base, [kind === 'logo' ? 'logoUrl' : 'markUrl']: url }, `${kind} uploaded`);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'brand.image_uploaded', entity: 'org_asset', entityId: kind, after: { mime: t.mime, bytes: data.length, sha256: sha }, ip: c.ip, userAgent: c.userAgent });
  return url;
}

/** Public read (the sign-in page needs the logo before anyone is signed in). Returns only the image bytes. */
export async function publicBrandImage(slug: string, kind: string): Promise<{ mime: string; bytes: Buffer; sha: string } | null> {
  if (!/^[a-z0-9-]{2,41}$/.test(slug) || !['logo', 'mark'].includes(kind)) return null;
  const r = (await (await privileged()).query<any>(`select a.mime, a.bytes, a.sha256 from org_assets a join organizations o on o.id = a.org_id where o.slug = $1 and a.kind = $2 and o.status = 'active'`, [slug, kind]))[0];
  return r ? { mime: r.mime, bytes: Buffer.from(r.bytes), sha: r.sha256 } : null;
}
