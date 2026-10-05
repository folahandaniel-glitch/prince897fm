'use client';
import { useActionState } from 'react';

type S = { ok?: string; error?: string } | null;
export function ForgotForm({ action }: { action: (p: S, d: FormData) => Promise<S> }) {
  const [s, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="mt-5 space-y-4">
      <div><label className="label" htmlFor="org">Organisation code</label><input id="org" name="org" required autoCapitalize="none" className="input" /></div>
      <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" required autoComplete="username" className="input" /></div>
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-emerald-800 dark:text-emerald-300">{s?.ok}</p>
      <button disabled={pending} className="btn-primary w-full">{pending ? 'Sending…' : 'Send reset link'}</button>
    </form>
  );
}
