import crypto from 'node:crypto';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { privileged } from '@/server/db';
import { boot } from '@/server/session';
import { createOrganization } from '@/server/backend';
import { createSuperAdmin } from '@/server/seed';
import { hashPassword, passwordProblem, revokeUserSessions } from '@/server/auth';
import { ORG_TEMPLATES } from '@/domain/templates';
import { UserError } from '@/server/ctx';
import { checkDatabase, type CheckReport } from '@/server/dbcheck';
import { SetupForm } from './form';

export const metadata = { title: 'First-time setup', robots: { index: false } };
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // a sleeping database can take a while to wake up

type S = { ok?: string; error?: string } | null;

/** Turns a start-up failure into something the owner can act on, without ever showing a connection string. */
function diagnose(e: unknown): { what: string; fix: string } {
  const raw = String((e as Error)?.message ?? e).replace(/postgres(ql)?:\/\/\S+/gi, '[database url]').slice(0, 400);
  if (/DATABASE_URL is not set/i.test(raw)) return { what: 'The DATABASE_URL variable is missing.', fix: 'In Vercel: Settings → Environment Variables, add DATABASE_URL (your Postgres connection string), then redeploy.' };
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)) return { what: 'The database address could not be found.', fix: 'Copy the connection string again from your database provider (host name looks wrong) and update DATABASE_URL.' };
  if (/password authentication failed|authentication/i.test(raw)) return { what: 'The database refused the user name or password.', fix: 'Copy a fresh connection string from your database provider and update DATABASE_URL.' };
  if (/ECONNREFUSED|ETIMEDOUT|timeout|CONNECT_TIMEOUT|terminat/i.test(raw)) return { what: 'The database did not answer in time.', fix: 'Check the database is running (Neon projects sleep and wake in a few seconds), that the string ends with ?sslmode=require, and try again.' };
  if (/SSL|TLS/i.test(raw)) return { what: 'The secure (SSL) connection to the database failed.', fix: 'Make sure DATABASE_URL ends with ?sslmode=require.' };
  if (/another application/i.test(raw)) return { what: 'That database already belongs to another application.', fix: 'Use a separate, empty database for WorkSuite (or add DB_SCHEMA=worksuite).' };
  if (/Migration .* failed/i.test(raw)) return { what: 'Installing the database tables failed.', fix: 'Send this message to your developer: ' + raw };
  return { what: 'WorkSuite could not start.', fix: 'Send this message to your developer: ' + raw };
}

/** Technical detail with host names and addresses masked. */
function detail(e: unknown): string {
  const code = (e as { code?: string })?.code;
  // Any word that looks like a host name, address or url (contains a dot, colon or slash) is hidden.
  const msg = String((e as Error)?.message ?? e).split(' ').map((w) => (/[.:/@]/.test(w) && w.length > 5 ? '[hidden]' : w)).join(' ').slice(0, 300);
  return `${code ? code + ': ' : ''}${msg}`;
}

/** One-time bootstrap for a fresh deployment: only works while SETUP_TOKEN is set. */
async function setup(_p: S, f: FormData): Promise<S> {
  'use server';
  const expected = process.env.SETUP_TOKEN ?? '';
  try { await boot(); } catch (e) { console.error('[setup] start failed', e); const d = diagnose(e); return { error: `${d.what} ${d.fix}` }; }
  const p = await privileged();
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const key = `setup:${ip}`;
  const [{ c }] = await p.query<{ c: number }>(`select count(*)::int c from login_attempts where key = $1 and created_at > now() - interval '15 minutes'`, [key]);
  if (c >= 5) return { error: 'Too many attempts. Wait 15 minutes.' };
  const given = String(f.get('token') ?? '');
  const ok = expected.length >= 16 && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  await p.query('insert into login_attempts(key, success) values ($1,$2)', [key, ok]);
  if (!ok) return { error: 'The setup token is not correct.' };
  const orgCount = Number((await p.query<any>('select count(*)::int n from organizations'))[0].n);
  const chosen = String(f.get('sapw') ?? '');
  if (String(f.get('mode') ?? '') === 'resetsa') {
    // Recovery: set a new password for the existing Super Admin. Same token, same rate limit.
    const slug = String(f.get('slug') ?? '').trim().toLowerCase();
    const email = String(f.get('sa') ?? '').trim().toLowerCase();
    const u = (await p.query<any>('select u.id from users u join organizations o on o.id = u.org_id where o.slug = $1 and u.email = $2 and u.platform_admin', [slug, email]))[0];
    if (!u) return { error: 'No Super Admin with that email exists in that organisation. Check the organisation code and the full email (including .com).' };
    if (!chosen) return { error: 'Type the new password.' };
    const problem = passwordProblem(chosen, { email });
    if (problem) return { error: problem };
    await p.query('update users set password_hash = $2, must_change_password = false, password_changed_at = now(), status = $3 where id = $1', [u.id, hashPassword(chosen), 'active']);
    await p.query('delete from login_attempts where key = $1', [`${slug}:${email}`]);
    await revokeUserSessions(u.id);
    return { ok: `Password changed for ${email}. Sign in at /login (organisation code ${slug}) or use the BackEnd link in the footer.` };
  }
  if (String(f.get('mode') ?? '') === 'superadmin') {
    // Recovery path: add the hidden Super Admin to an existing organisation that has none. Needs the same token.
    const slug = String(f.get('slug') ?? '').trim().toLowerCase();
    const email = String(f.get('sa') ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Enter a valid email for the Super Admin.' };
    const org = (await p.query<any>('select id from organizations where slug = $1', [slug]))[0];
    if (!org) return { error: 'No organisation has that code.' };
    if ((await p.query('select 1 from users where org_id = $1 and platform_admin', [org.id]))[0]) return { error: 'This organisation already has a Super Admin. Use its password reset, or ask the platform owner.' };
    if ((await p.query('select 1 from users where org_id = $1 and email = $2', [org.id, email]))[0]) return { error: 'That email is already used by another account in this organisation. Use a different one.' };
    if (chosen) { const problem = passwordProblem(chosen, { email }); if (problem) return { error: problem }; }
    try {
      const r = await createSuperAdmin(org.id, email, null, '', chosen || undefined);
      return { ok: chosen
        ? `Super Admin created for ${slug}.\nEmail: ${email}\nPassword: the one you just chose.\n\nSign in at /login, then use the BackEnd link in the footer. You can change the password under BackEnd → My account.`
        : `Super Admin created for ${slug}.\nEmail: ${email}\nOne-time password: ${r.password}\n\nCopy it now: it is shown only once. Sign in at /login, choose a new password when asked, then use the BackEnd link in the footer.` };
    } catch (e) { console.error(e); return { error: 'Could not create the Super Admin. Nothing was changed.' }; }
  }
  if (orgCount > 0) return { error: 'Setup is already complete.' };
  try {
    const sa = String(f.get('sa') ?? '').trim() || undefined;
    const r = await createOrganization({ slug: String(f.get('slug') ?? ''), name: String(f.get('name') ?? ''), templateKey: String(f.get('template') ?? 'blank'), adminEmail: String(f.get('email') ?? ''), adminName: String(f.get('admin') ?? '') || undefined, superAdminEmail: sa, superAdminPassword: sa && chosen ? chosen : undefined }, null);
    return { ok: `Created. Organisation code: ${r.slug}\nAdministrator one-time password: ${r.adminPassword}${r.superAdminChosePassword ? `\nSuper Admin: ${sa}, with the password you chose` : r.superAdminPassword ? `\nSuper Admin one-time password: ${r.superAdminPassword}` : ''}\n\nCopy these now: they are shown only once. Sign in at /login${r.superAdminChosePassword ? '' : ' and you will be asked to choose a new password'}. This page is now disabled.` };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    console.error(e);
    return { error: 'Setup failed. Nothing was created.' };
  }
}

export default async function Setup() {
  if (!process.env.SETUP_TOKEN) notFound();
  let n = 0, needsSa = false, failure: { what: string; fix: string } | null = null, report: CheckReport | null = null, tech = '';
  try {
    await boot();
    const pq = await privileged();
    n = Number((await pq.query<any>('select count(*)::int n from organizations'))[0].n);
    needsSa = n > 0 && !(await pq.query('select 1 from users where platform_admin limit 1'))[0];
  } catch (e) {
    console.error('[setup] start failed', e);
    failure = diagnose(e);
    tech = detail(e);
    try { report = await checkDatabase(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL); } catch { report = null; }
  }
  return (
    <main id="main" className="grid min-h-screen place-items-center bg-[#0b0b0b] p-4"><div className="card w-full max-w-lg">
      <h1 className="text-2xl font-bold">First-time setup</h1>
      {failure ? (
        <div role="alert" className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
          <p className="font-semibold">{failure.what}</p><p className="mt-1">{failure.fix}</p>
          {report && <>
            <ul className="mt-3 space-y-1">{report.steps.map((s) => <li key={s.name}>{s.ok ? '✅' : '❌'} {s.name}: {s.note}</li>)}</ul>
            <p className="mt-2 font-medium">{report.hint}</p></>}
          <p className="mt-3 break-words font-mono text-xs opacity-80">Technical detail: {tech}</p>
          <p className="mt-2 text-xs opacity-80">After fixing it, redeploy and reload this page.</p>
        </div>
      ) : (<>
        <p className="mt-1 text-sm text-muted">Create your organisation and its first administrator. You need the SETUP_TOKEN you saved in Vercel. Once an organisation exists the page switches itself off.</p>
        <SetupForm action={setup} done={n > 0} needsSuperAdmin={needsSa} templates={ORG_TEMPLATES.map((t) => ({ value: t.key, label: t.label }))} />
      </>)}
    </div></main>
  );
}
