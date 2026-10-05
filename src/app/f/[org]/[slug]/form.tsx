'use client';
import { useActionState } from 'react';

type State = { ok?: string; error?: string } | null;

export function PublicForm({ action, org, slug, children }: { action: (p: State, d: FormData) => Promise<State>; org: string; slug: string; children: React.ReactNode }) {
  const [state, run, pending] = useActionState(action, null);
  if (state?.ok) return <p role="status" className="mt-5 rounded-xl bg-emerald-50 p-4 text-emerald-900">{state.ok}</p>;
  return (
    <form action={run} className="mt-5">
      <input type="hidden" name="__org" value={org} /><input type="hidden" name="__slug" value={slug} />
      {/* Honeypot: invisible to people, tempting to bots. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', height: 0, overflow: 'hidden' }}><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      {children}
      <p role="alert" aria-live="assertive" className="min-h-5 text-sm text-red-700">{state?.error}</p>
      <button type="submit" disabled={pending} className="btn-primary mt-2 w-full">{pending ? 'Sending…' : 'Submit'}</button>
    </form>
  );
}
