import crypto from 'node:crypto';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { privileged } from '@/server/db';
import { boot } from '@/server/session';
import { createOrganization } from '@/server/backend';
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
  if (Number((await p.query<any>('select count(*)::int n from organizations'))[0].n) > 0) return { error: 'Setup is already complete.' };
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
  const n = Number((await (await privileged()).query<any>('select count(*)::int n from organizations'))[0].n);
  return (
    <main id="main" className="grid min-h-screen place-items-center bg-[#0b0b0b] p-4"><div className="card w-full max-w-lg">
      <h1 className="text-2xl font-bold">First-time setup</h1>
      <p className="mt-1 text-sm text-muted">Create your organisation and its first administrator. You need the SETUP_TOKEN you saved in Vercel. Once an organisation exists the page switches itself off.</p>
      <SetupForm action={setup} done={n > 0} templates={ORG_TEMPLATES.map((t) => ({ value: t.key, label: t.label }))} />
    </div></main>
  );
}
