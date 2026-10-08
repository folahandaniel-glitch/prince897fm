'use client';
import { useActionState, useEffect, useRef, useState } from 'react';

type State = { error?: string } | null;

const Ico = ({ d }: { d: React.ReactNode }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;

export function LoginForm({ action, defaultOrg, next }: { action: (p: State, d: FormData) => Promise<State>; defaultOrg: string; next: string }) {
  const [state, run, pending] = useActionState(action, null);
  const orgRef = useRef<HTMLInputElement>(null);
  const [show, setShow] = useState(false);
  // Allow ?org=code deep links; the page itself is rendered per request but this keeps the form usable from any bookmark.
  useEffect(() => { const o = new URLSearchParams(location.search).get('org'); if (o && orgRef.current) orgRef.current.value = o; }, []);
  return (
    <form action={run} className="mt-7 space-y-4" noValidate={false}>
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="label !text-slate-200" htmlFor="org">Organisation code</label>
        <div className="auth-field"><Ico d={<><path d="M4 20V8l8-4 8 4v12" /><path d="M9 20v-6h6v6M8 10h.01M12 10h.01M16 10h.01" /></>} />
          <input id="org" ref={orgRef} name="org" required defaultValue={defaultOrg} autoCapitalize="none" autoCorrect="off" spellCheck={false} className="input !border-white/15 !bg-white/5 !text-white placeholder:!text-slate-500" placeholder="e.g. prince897" /></div>
      </div>
      <div>
        <label className="label !text-slate-200" htmlFor="email">Email or username</label>
        <div className="auth-field"><Ico d={<><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 6 8-6" /></>} />
          <input id="email" name="email" type="text" required autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" className="input !border-white/15 !bg-white/5 !text-white placeholder:!text-slate-500" placeholder="you@company.com or your username" /></div>
      </div>
      <div>
        <div className="flex items-center justify-between"><label className="label !mb-1 !text-slate-200" htmlFor="password">Password</label><a href="/forgot" className="text-xs text-slate-300 underline-offset-2 hover:underline">Forgot password?</a></div>
        <div className="auth-field"><Ico d={<><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>} />
          <input id="password" name="password" type={show ? 'text' : 'password'} required autoComplete="current-password" className="input !border-white/15 !bg-white/5 !pr-12 !text-white" />
          <button type="button" onClick={() => setShow((v) => !v)} aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-slate-300 hover:bg-white/10">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{show ? <><path d="M3 3l18 18" /><path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c5 0 8.5 4.2 9.5 6-.4.8-1.3 2.1-2.7 3.3M6.4 7.7C4.4 9 3 11 2.5 12c1 1.8 4.5 6 9.5 6 1.5 0 2.8-.4 4-1M9.9 9.9a3 3 0 0 0 4.2 4.2" /></> : <><path d="M2.5 12C3.5 10.2 7 6 12 6s8.5 4.2 9.5 6c-1 1.8-4.5 6-9.5 6s-8.5-4.2-9.5-6z" /><circle cx="12" cy="12" r="3" /></>}</svg>
          </button></div>
      </div>
      <p role="alert" aria-live="assertive" className={`rounded-lg border px-3 py-2 text-sm ${state?.error ? 'border-red-400/40 bg-red-500/10 text-red-200' : 'sr-only'}`}>{state?.error}</p>
      <button type="submit" disabled={pending} className="btn w-full !min-h-[48px] bg-[rgb(var(--accent))] !text-base !text-black shadow-lg shadow-black/30 hover:brightness-110 disabled:opacity-70">
        {pending ? <><svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity=".25" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg> Signing in…</> : 'Sign in'}
      </button>
    </form>
  );
}
