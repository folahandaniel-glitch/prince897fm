import crypto from 'node:crypto';

/** RFC 6238 time-based one-time passwords (compatible with Google/Microsoft Authenticator, Authy, 1Password…). */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function unbase32(s: string): Buffer {
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(ch); if (i < 0) continue; value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}

export function generateSecret(): string { return base32(crypto.randomBytes(20)); }

export function totp(secret: string, atMs = Date.now(), step = 30, digits = 6): string {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / step)));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(counter).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}

/** Accepts the current code and one step either side (clock drift). Constant-time comparison. */
export function verifyTotp(secret: string, code: string, atMs = Date.now()): boolean {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  let ok = false;
  for (const drift of [-1, 0, 1]) {
    const expected = totp(secret, atMs + drift * 30_000);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) ok = true;
  }
  return ok;
}

// Secrets at rest are encrypted with a key derived from APP_SECRET (AES-256-GCM).
// During a rotation APP_SECRET_PREVIOUS may also be set: values are read with either key and written with the current one.
function keyFor(secret: string) { return crypto.createHash('sha256').update(`worksuite:${secret}`).digest(); }
function currentSecret() {
  const s = process.env.APP_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'development-only-secret-change-me');
  if (!s) throw new Error('APP_SECRET is required in production (used to encrypt MFA secrets).');
  return s;
}
export function encryptWith(secret: string, plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFor(secret), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}
export function decryptWith(secret: string, blob: string): string {
  const [iv, tag, ct] = blob.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', keyFor(secret), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}
export const encryptSecret = (plain: string) => encryptWith(currentSecret(), plain);
export function decryptSecret(blob: string): string {
  try { return decryptWith(currentSecret(), blob); } catch (e) {
    const prev = process.env.APP_SECRET_PREVIOUS;
    if (!prev) throw e;
    return decryptWith(prev, blob);
  }
}

export const otpauthUri = (secret: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
