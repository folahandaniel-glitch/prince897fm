import crypto from 'node:crypto';
import { privileged } from './db';
import { decryptSecret, verifyTotp } from './mfa';

const N = 32768, R = 8, P = 1, KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 128 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const dk = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p, maxmem: 128 * 1024 * 1024 });
  return crypto.timingSafeEqual(dk, expected);
}

const DUMMY = hashPassword('dummy-password-for-timing-equalisation');

const COMMON = new Set(['password1234', '123456789012', 'qwertyuiop12', 'worksuite1234', 'welcome12345', 'changeme1234']);

/** NIST SP 800-63B style: length over composition, screen obvious choices, no forced rotation. */
export function passwordProblem(pw: string, ctx: { email?: string } = {}): string | null {
  if (pw.length < 12) return 'Use at least 12 characters. A short passphrase of unrelated words works well.';
  if (pw.length > 128) return 'Use at most 128 characters.';
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common. Choose something less guessable.';
  if (/^(.)\1+$/.test(pw)) return 'Avoid repeating a single character.';
  if (ctx.email && pw.toLowerCase().includes(ctx.email.split('@')[0].toLowerCase()) && ctx.email.split('@')[0].length > 3) return 'Do not include your email name in your password.';
  return null;
}

export const SESSION_COOKIE = 'ws_session';
const ABSOLUTE_MS = 12 * 60 * 60 * 1000;
const IDLE_MS = 60 * 60 * 1000;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export type LoginResult =
  | { ok: true; token: string; orgId: string; userId: string; maxAgeSec: number; mfaRequired: boolean }
  | { ok: false; error: string };

export async function login(orgSlug: string, emailRaw: string, password: string, ip?: string | null, userAgent?: string | null): Promise<LoginResult> {
  const q = await privileged();
  const email = emailRaw.trim().toLowerCase();
  const slug = orgSlug.trim().toLowerCase();
  const key = `${slug}:${email}`;
  const ipKey = `ip:${ip ?? 'unknown'}`;
  const [{ c: byKey }] = await q.query<{ c: number }>(`select count(*)::int c from login_attempts where key = $1 and not success and created_at > now() - interval '15 minutes'`, [key]);
  const [{ c: byIp }] = await q.query<{ c: number }>(`select count(*)::int c from login_attempts where key = $1 and not success and created_at > now() - interval '15 minutes'`, [ipKey]);
  if (byKey >= 5 || byIp >= 30) return { ok: false, error: 'Too many failed attempts. Please wait 15 minutes and try again.' };

  const rows = await q.query<any>(
    `select u.id, u.org_id, u.password_hash, u.status, u.mfa_enabled, o.status as org_status from users u join organizations o on o.id = u.org_id where o.slug = $1 and u.email = $2`,
    [slug, email],
  );
  const u = rows[0];
  const valid = verifyPassword(password, u?.password_hash ?? DUMMY) && !!u;
  const allowed = valid && u.status === 'active' && u.org_status === 'active';
  await q.query('insert into login_attempts(key, success) values ($1,$2), ($3,$2)', [key, allowed, ipKey]);
  if (!allowed) return { ok: false, error: 'Incorrect organisation code, email or password.' }; // deliberately generic

  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const pending = !!u.mfa_enabled;
  await q.query(
    'insert into sessions (user_id, org_id, token_hash, expires_at, idle_expires_at, ip, user_agent, mfa_pending) values ($1,$2,$3,$4,$5,$6,$7,$8)',
    [u.id, u.org_id, sha(token), new Date(now + (pending ? 10 * 60 * 1000 : ABSOLUTE_MS)), new Date(now + (pending ? 10 * 60 * 1000 : IDLE_MS)), ip ?? null, userAgent?.slice(0, 300) ?? null, pending],
  );
  await q.query('delete from sessions where expires_at < now() or idle_expires_at < now()');
  return { ok: true, token, orgId: u.org_id, userId: u.id, maxAgeSec: pending ? 600 : ABSOLUTE_MS / 1000, mfaRequired: pending };
}

/** Second step: a session created after the password is "pending" until the one-time code is verified. */
export async function completeMfa(token: string | undefined, code: string, ip?: string | null): Promise<{ ok: true; maxAgeSec: number } | { ok: false; error: string }> {
  if (!token) return { ok: false, error: 'Your sign-in expired. Please start again.' };
  const q = await privileged();
  const s = (await q.query<any>(
    `select s.id, s.user_id, u.mfa_secret_enc from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and s.mfa_pending and s.expires_at > now()`, [sha(token)]))[0];
  if (!s) return { ok: false, error: 'Your sign-in expired. Please start again.' };
  const key = `mfa:${s.user_id}`;
  const [{ c }] = await q.query<{ c: number }>(`select count(*)::int c from login_attempts where key = $1 and not success and created_at > now() - interval '15 minutes'`, [key]);
  if (c >= 5) return { ok: false, error: 'Too many wrong codes. Please wait 15 minutes.' };
  const ok = verifyTotp(decryptSecret(s.mfa_secret_enc), code);
  await q.query('insert into login_attempts(key, success) values ($1,$2)', [key, ok]);
  if (!ok) return { ok: false, error: 'That code is not right. Check the time on your phone and try the next code.' };
  const now = Date.now();
  await q.query('update sessions set mfa_pending = false, expires_at = $2, idle_expires_at = $3 where id = $1', [s.id, new Date(now + ABSOLUTE_MS), new Date(now + IDLE_MS)]);
  return { ok: true, maxAgeSec: ABSOLUTE_MS / 1000 };
}

export interface SessionInfo {
  id: string; user_id: string; org_id: string; email: string; org_name: string; org_slug: string; timezone: string; currency: string; locale: string;
  must_change_password: boolean; hidden: boolean; mfa_enabled: boolean; platform_admin: boolean;
}

export async function resolveSession(token: string | undefined): Promise<SessionInfo | null> {
  if (!token) return null;
  const q = await privileged();
  const rows = await q.query<any>(
    `select s.idle_expires_at, s.id, s.user_id, s.org_id, u.email, u.status, u.must_change_password, u.hidden, u.mfa_enabled, u.platform_admin,
            o.name as org_name, o.slug as org_slug, o.timezone, o.currency, o.locale
       from sessions s join users u on u.id = s.user_id join organizations o on o.id = s.org_id
      where s.token_hash = $1 and not s.mfa_pending and s.expires_at > now() and s.idle_expires_at > now() and u.status = 'active' and o.status = 'active'`,
    [sha(token)],
  );
  const s = rows[0];
  if (!s) return null;
  // Slide the idle window at most every 5 minutes: avoids a database write on every request.
  if (new Date(s.idle_expires_at).getTime() - Date.now() < IDLE_MS - 5 * 60 * 1000) await q.query('update sessions set idle_expires_at = $2 where id = $1', [s.id, new Date(Date.now() + IDLE_MS)]);
  return s as SessionInfo;
}

export async function destroySession(token: string | undefined) {
  if (!token) return;
  await (await privileged()).query('delete from sessions where token_hash = $1', [sha(token)]);
}

export async function revokeUserSessions(userId: string, exceptToken?: string) {
  await (await privileged()).query('delete from sessions where user_id = $1 and ($2::text is null or token_hash <> $2)', [userId, exceptToken ? sha(exceptToken) : null]);
}

/** A strong random one-time password for account creation/reset. Shown once; the user must change it at first sign-in. */
export const oneTimePassword = () => crypto.randomBytes(15).toString('base64url');

export async function changePassword(userId: string, email: string, current: string, next: string, keepToken?: string): Promise<string | null> {
  const q = await privileged();
  const u = (await q.query<any>('select password_hash from users where id = $1', [userId]))[0];
  if (!u || !verifyPassword(current, u.password_hash)) return 'Your current password is not correct.';
  const problem = passwordProblem(next, { email });
  if (problem) return problem;
  if (verifyPassword(next, u.password_hash)) return 'Choose a password different from the current one.';
  await q.query('update users set password_hash = $2, must_change_password = false, password_changed_at = now() where id = $1', [userId, hashPassword(next)]);
  await revokeUserSessions(userId, keepToken);
  return null;
}

/** Changes the address used to sign in. Needs the current password; other devices are signed out. Returns an error message or null. */
export async function changeLoginEmail(userId: string, currentPassword: string, newEmailRaw: string, keepToken?: string): Promise<string | null> {
  const q = await privileged();
  const email = newEmailRaw.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return 'Enter a valid email address.';
  const u = (await q.query<any>('select org_id, email, password_hash from users where id = $1', [userId]))[0];
  if (!u || !verifyPassword(currentPassword, u.password_hash)) return 'Your current password is not correct.';
  if (email === u.email) return 'That is already your sign-in email.';
  if ((await q.query('select 1 from users where org_id = $1 and email = $2', [u.org_id, email]))[0]) return 'That email is already used by another account in this organisation.';
  await q.query('update users set email = $2 where id = $1', [userId, email]);
  await q.query('update employees set email = $2 where user_id = $1', [userId, email]);
  await revokeUserSessions(userId, keepToken);
  return null;
}
