import crypto from 'node:crypto';
import sharp from 'sharp';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';

/**
 * Profile pictures. Whatever the person uploads (a phone photo can be 5 MB) is turned into a small square WebP of at most 10 KB:
 * rotated upright, centred on the subject, stripped of location and camera data, then saved at the best quality that fits.
 */
export const MAX_UPLOAD = 4 * 1024 * 1024;
export const TARGET_BYTES = 10_000;

function sniff(b: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

export async function compressPhoto(input: Buffer): Promise<{ bytes: Buffer; size: number; quality: number }> {
  if (input.length === 0) throw new UserError('Choose a picture.');
  if (input.length > MAX_UPLOAD) throw new UserError('That picture is larger than 4 MB. Choose a smaller one.');
  if (!sniff(input)) throw new UserError('Use a JPEG, PNG or WebP picture.');
  let base: ReturnType<typeof sharp>;
  try { base = sharp(input, { limitInputPixels: 50_000_000, failOn: 'error' }).rotate(); await base.metadata(); }
  catch { throw new UserError('That picture could not be read. Try another one.'); }
  // Try the largest size first and shrink only when even a low quality does not fit.
  for (const side of [256, 224, 192, 160, 128, 96]) {
    for (const quality of [86, 78, 70, 62, 54, 46, 38, 30]) {
      const out = await base.clone().resize(side, side, { fit: 'cover', position: sharp.strategy.attention }).webp({ quality, effort: 4, smartSubsample: true }).toBuffer();
      if (out.length <= TARGET_BYTES) return { bytes: out, size: side, quality };
    }
  }
  throw new UserError('That picture is too detailed to shrink well. Try a simpler one.');
}

export async function saveMyPhoto(c: Ctx, input: Buffer) {
  need(c, 'profile:edit:own');
  const r = await compressPhoto(input);
  const sha = crypto.createHash('sha256').update(r.bytes).digest('hex');
  await c.q.query(`insert into user_photos (user_id, org_id, bytes, sha256) values ($1,$2,$3,$4) on conflict (user_id) do update set bytes = excluded.bytes, sha256 = excluded.sha256, updated_at = now()`, [c.userId, c.orgId, r.bytes, sha]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'profile.photo_changed', entity: 'user', entityId: c.userId, after: { bytes: r.bytes.length, side: r.size }, ip: c.ip, userAgent: c.userAgent });
  return { bytes: r.bytes.length, side: r.size, sha };
}

export async function removePhoto(c: Ctx, userId: string) {
  if (userId !== c.userId) need(c, 'admin:control'); else need(c, 'profile:edit:own');
  await c.q.query('delete from user_photos where user_id = $1', [userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'profile.photo_removed', entity: 'user', entityId: userId, ip: c.ip, userAgent: c.userAgent });
}

export async function photoFor(c: Ctx, userId: string) {
  const r = (await c.q.query<any>('select bytes, sha256 from user_photos where user_id = $1', [userId]))[0];
  return r ? { bytes: Buffer.from(r.bytes), sha: r.sha256 as string } : null;
}
