'use client';
import { useActionState } from 'react';

export function MfaForm({ action }: { action: (p: { error?: string } | null, d: FormData) => Promise<{ error?: string } | null> }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="mt-5 space-y-4">
      <div><label className="label" htmlFor="code">6-digit code</label>
        <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required autoFocus className="input text-center text-2xl tracking-widest" /></div>
      <p role="alert" aria-live="assertive" className="min-h-5 text-sm text-red-700 dark:text-red-400">{state?.error}</p>
      <button type="submit" disabled={pending} className="btn-primary w-full">{pending ? 'Checking…' : 'Verify'}</button>
    </form>
  );
}
