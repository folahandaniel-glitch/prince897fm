import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { emailConfigured, flushOutbox } from '@/server/messaging';
import { requestPasswordReset } from '@/server/reset';
import { boot } from '@/server/session';
import { ForgotForm } from './form';

export const dynamic = 'force-dynamic'; // rendered per request so every script can carry the request's CSP nonce
export const metadata = { title: 'Forgot password' };

async function send(_p: { ok?: string; error?: string } | null, f: FormData) {
  'use server';
  await boot();
  const h = await headers();
  await requestPasswordReset(String(f.get('org') ?? ''), String(f.get('email') ?? ''), h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null);
  if (emailConfigured()) after(() => flushOutbox().catch(() => {}));
  return { ok: 'If that account exists, a reset link is on its way. It is valid for 1 hour. If nothing arrives, ask your administrator for a one-time password.' };
}

export default function Forgot() {
  return (
    <main id="main" className="grid min-h-screen place-items-center bg-[#0b0b0b] p-4"><div className="card w-full max-w-md"><BrandMark />
      <h1 className="text-2xl font-bold">Forgot your password?</h1>
      <p className="mt-1 text-sm text-muted">Enter your organisation code and email. We will send you a link to choose a new password.</p>
      <ForgotForm action={send} />
      <p className="mt-4 text-sm"><Link className="underline" href="/login">Back to sign in</Link></p></div></main>
  );
}
