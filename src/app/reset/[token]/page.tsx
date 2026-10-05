import Link from 'next/link';
import { resetPassword } from '@/server/reset';
import { boot } from '@/server/session';
import { ResetForm } from './form';

export const metadata = { title: 'Choose a new password' };
export const dynamic = 'force-dynamic';

export default async function Reset({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  async function apply(_p: { ok?: string; error?: string } | null, f: FormData) {
    'use server';
    await boot();
    const a = String(f.get('password') ?? ''); const b = String(f.get('confirm') ?? '');
    if (a !== b) return { error: 'The two passwords do not match.' };
    const err = await resetPassword(token, a);
    return err ? { error: err } : { ok: 'Password changed. You can now sign in.' };
  }
  return (
    <main id="main" className="grid min-h-screen place-items-center bg-[#0b0b0b] p-4"><div className="card w-full max-w-md">
      <h1 className="text-2xl font-bold">Choose a new password</h1>
      <p className="mt-1 text-sm text-muted">At least 12 characters. A short passphrase of unrelated words works well.</p>
      <ResetForm action={apply} />
      <p className="mt-4 text-sm"><Link className="underline" href="/login">Go to sign in</Link></p></div></main>
  );
}
