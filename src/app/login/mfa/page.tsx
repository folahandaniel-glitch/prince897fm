import { cookies, headers } from 'next/headers';
import { BrandMark } from '@/components/brand-mark';
import { redirect } from 'next/navigation';
import { completeMfa, SESSION_COOKIE } from '@/server/auth';
import { boot } from '@/server/session';
import { MfaForm } from './form';

export const dynamic = 'force-dynamic'; // rendered per request so every script can carry the request's CSP nonce
export const metadata = { title: 'Verify sign-in' };

async function verify(_p: { error?: string } | null, data: FormData): Promise<{ error?: string } | null> {
  'use server';
  await boot();
  const c = await cookies();
  const h = await headers();
  const r = await completeMfa(c.get(SESSION_COOKIE)?.value, String(data.get('code') ?? ''), h.get('x-forwarded-for'));
  if (!r.ok) return { error: r.error };
  c.set(SESSION_COOKIE, c.get(SESSION_COOKIE)!.value, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: r.maxAgeSec });
  const next = c.get('ws_next')?.value;
  c.delete({ name: 'ws_next', path: '/login' });
  redirect(next && /^\/(backend|dashboard)(\/[a-z0-9\-/]*)?$/.test(next) ? next : '/dashboard');
}

export default function MfaPage() {
  return (
    <main id="main" className="grid min-h-[100dvh] place-items-center bg-[#0b0b0b] p-4">
      <div className="card w-full max-w-sm"><BrandMark />
        <h1 className="text-2xl font-bold">Two-step verification</h1>
        <p className="mt-1 text-sm text-muted">Open your authenticator app and enter the 6-digit code for this account.</p>
        <MfaForm action={verify} />
      </div>
    </main>
  );
}
