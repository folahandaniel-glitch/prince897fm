'use client';
import { useActionState, useEffect, useRef } from 'react';

export function LoginForm({ action, defaultOrg }: { action: (p: { error?: string } | null, d: FormData) => Promise<{ error?: string } | null>; defaultOrg: string }) {
  const [state, run, pending] = useActionState(action, null);
  const orgRef = useRef<HTMLInputElement>(null);
  // Allow ?org=code deep links without making the page dynamic (keeps it statically cached).
  useEffect(() => { const o = new URLSearchParams(location.search).get('org'); if (o && orgRef.current) orgRef.current.value = o; }, []);
  return (
    <form action={run} className="mt-5 space-y-4">
      <div><label className="label" htmlFor="org">Organisation code</label>
        <input id="org" ref={orgRef} name="org" required defaultValue={defaultOrg} autoCapitalize="none" autoCorrect="off" className="input" placeholder="e.g. prince897" /></div>
      <div><label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="username" className="input" /></div>
      <div><label className="label" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" className="input" /></div>
      <p role="alert" aria-live="assertive" className="min-h-5 text-sm text-red-700 dark:text-red-400">{state?.error}</p>
      <button type="submit" disabled={pending} className="btn-primary w-full">{pending ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}
