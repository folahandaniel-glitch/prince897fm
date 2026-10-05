import crypto from 'node:crypto';
import { hashPassword, passwordProblem, revokeUserSessions } from './auth';
import { privileged } from './db';

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** Always behaves the same whether or not the account exists (no account enumeration). Delivery goes through the outbox. */
export async function requestPasswordReset(orgSlug: string, emailRaw: string, ip?: string | null): Promise<void> {
  const q = await privileged();
  const email = emailRaw.trim().toLowerCase();
  const slug = orgSlug.trim().toLowerCase();
  const key = `reset:${slug}:${email}`;
  const ipKey = `reset-ip:${ip ?? 'unknown'}`;
  const [{ c: a }] = await q.query<{ c: number }>(`select count(*)::int c from login_attempts where key = $1 and created_at > now() - interval '1 hour'`, [key]);
  const [{ c: b }] = await q.query<{ c: number }>(`select count(*)::int c from login_attempts where key = $1 and created_at > now() - interval '1 hour'`, [ipKey]);
  await q.query('insert into login_attempts(key, success) values ($1,false), ($2,false)', [key, ipKey]);
  if (a >= 3 || b >= 10) return;
  const u = (await q.query<any>(`select u.id, u.org_id, u.email from users u join organizations o on o.id = u.org_id where o.slug = $1 and u.email = $2 and u.status = 'active' and o.status = 'active'`, [slug, email]))[0];
  if (!u) return;
  const token = crypto.randomBytes(32).toString('base64url');
  await q.query(`insert into password_resets (user_id, token_hash, expires_at) values ($1,$2,now() + interval '1 hour')`, [u.id, sha(token)]);
  const base = process.env.APP_URL?.replace(/\/$/, '') ?? '';
  await q.query(`insert into outbox (org_id, user_id, channel, to_addr, subject, body) values ($1,$2,'email',$3,$4,$5)`,
    [u.org_id, u.id, u.email, 'Reset your password', `Use this link within 1 hour to choose a new password:\n\n${base}/reset/${token}\n\nIf you did not ask for this, ignore this message: your password is unchanged.`]);
  return;
}

/** Consume a reset token and set the new password. All sessions of the user are revoked. */
export async function resetPassword(token: string, next: string): Promise<string | null> {
  const q = await privileged();
  const r = (await q.query<any>(`select p.id, p.user_id, u.email from password_resets p join users u on u.id = p.user_id where p.token_hash = $1 and p.used_at is null and p.expires_at > now()`, [sha(token)]))[0];
  if (!r) return 'This reset link is invalid or has expired. Request a new one.';
  const problem = passwordProblem(next, { email: r.email });
  if (problem) return problem;
  await q.query('update password_resets set used_at = now() where id = $1', [r.id]);
  await q.query('update users set password_hash = $2, must_change_password = false, password_changed_at = now() where id = $1', [r.user_id, hashPassword(next)]);
  await revokeUserSessions(r.user_id);
  return null;
}
