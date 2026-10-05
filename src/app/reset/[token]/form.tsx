'use client';
import { useActionState } from 'react';

type S = { ok?: string; error?: string } | null;
export function ResetForm({ action }: { action: (p: S, d: FormData) => Promise<S> }) {
  const [s, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="mt-5 space-y-4">
      <div><label className="label" htmlFor="password">New password</label><input id="password" name="password" type="password" required minLength={12} autoComplete="new-password" className="input" /></div>
      <div><label className="label" htmlFor="confirm">Confirm password</label><input id="confirm" name="confirm" type="password" required minLength={12} autoComplete="new-password" className="input" /></div>
      <p role="alert" aria-live="assertive" className="min-h-5 text-sm text-red-700 dark:text-red-400">{s?.error}</p>
      {s?.ok && <p role="status" className="text-sm text-emerald-800 dark:text-emerald-300">{s.ok}</p>}
      <button disabled={pending || !!s?.ok} className="btn-primary w-full">{pending ? 'Saving…' : 'Set password'}</button>
    </form>
  );
}
