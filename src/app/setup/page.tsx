import crypto from 'node:crypto';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { privileged } from '@/server/db';
import { boot } from '@/server/session';
import { createOrganization } from '@/server/backend';
import { createSuperAdmin } from '@/server/seed';
import { ORG_TEMPLATES } from '@/domain/templates';
import { UserError } from '@/server/ctx';
import { SetupForm } from './form';

export const metadata = { title: 'First-time setup', robots: { index: false } };
export const dynamic = 'force-dynamic';

type S = { ok?: string; error?: string } | null;

/** One-time bootstrap for a fresh deployment: only works while the database has no organisations and SETUP_TOKEN is set. */
async function setup(_p: S, f: FormData): Promise<S> {
  'use server';
  const expected = process.env.SETUP_TOKEN ?? '';
  await boot();
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
  if (String(f.get('mode') ?? '') === 'superadmin') {
    // Recovery path: add the hidden Super Admin to an existing organisation that has none. Needs the same token.
    const slug = String(f.get('slug') ?? '').trim().toLowerCase();
    const email = String(f.get('sa') ?? '').trim().toLowerCase();
    if (!/^[^@s]+@[^@s]+.[^@s]+$/.test(email)) return { error: 'Enter a valid email for the Super Admin.' };
    const org = (await p.query<any>('select id from organizations where slug = $1', [slug]))[0];
    if (!org) return { error: 'No organisation has that code.' };
    if ((await p.query('select 1 from users where org_id = $1 and platform_admin', [org.id]))[0]) return { error: 'This organisation already has a Super Admin. Use its password reset, or ask the platform owner.' };
    if ((await p.query('select 1 from users where org_id = $1 and email = $2', [org.id, email]))[0]) return { error: 'That email is already used by another account in this organisation. Use a different one.' };
    try {
      const r = await createSuperAdmin(org.id, email, null);
      return { ok: `Super Admin created for ${slug}.
Email: ${email}
One-time password: ${r.password}

Copy it now: it is shown only once. Sign in at /login, choose a new password when asked, then use the BackEnd link in the footer.` };
    } catch (e) { console.error(e); return { error: 'Could not create the Super Admin. Nothing was changed.' }; }
  }
  if (orgCount > 0) return { error: 'Setup is already complete.' };
  try {
    const r = await createOrganization({ slug: String(f.get('slug') ?? ''), name: String(f.get('name') ?? ''), templateKey: String(f.get('template') ?? 'blank'), adminEmail: String(f.get('email') ?? ''), adminName: String(f.get('admin') ?? '') || undefined, superAdminEmail: String(f.get('sa') ?? '').trim() || undefined }, null);
    return { ok: `Created. Organisation code: ${r.slug}\nAdministrator one-time password: ${r.adminPassword}${r.superAdminPassword ? `\nSuper Admin one-time password: ${r.superAdminPassword}` : ''}\n\nCopy these now: they are shown only once. Sign in at /login and you will be asked to choose a new password. This page is now disabled.` };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    console.error(e);
    return { error: 'Setup failed. Nothing was created.' };
  }
}

export default async function Setup() {
  if (!process.env.SETUP_TOKEN) notFound();
  await boot();
  const pq = await privileged();
  const n = Number((await pq.query<any>('select count(*)::int n from organizations'))[0].n);
  const needsSa = n > 0 && !(await pq.query('select 1 from users where platform_admin limit 1'))[0];
  return (
    <main id="main" className="grid min-h-screen place-items-center bg-[#0b0b0b] p-4"><div className="card w-full max-w-lg">
      <h1 className="text-2xl font-bold">First-time setup</h1>
      <p className="mt-1 text-sm text-muted">Create your organisation and its first administrator. You need the SETUP_TOKEN you saved in Vercel. Once an organisation exists the page switches itself off.</p>
      <SetupForm action={setup} done={n > 0} needsSuperAdmin={needsSa} templates={ORG_TEMPLATES.map((t) => ({ value: t.key, label: t.label }))} />
    </div></main>
  );
}
