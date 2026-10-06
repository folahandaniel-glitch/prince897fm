'use client';
import { useActionState } from 'react';
import { PasswordInput } from '@/components/forms';

type S = { ok?: string; error?: string } | null;

function F({ id, label, type = 'text', hint, req = true, def }: { id: string; label: string; type?: string; hint?: string; req?: boolean; def?: string }) {
  return (
    <div><label className="label" htmlFor={id}>{label}{req && <span aria-hidden> *</span>}</label>
      {type === 'password' ? <PasswordInput id={id} name={id} required={req} defaultValue={def} autoComplete="off" /> : <input id={id} name={id} type={type} required={req} defaultValue={def} autoCapitalize="none" autoComplete="off" className="input" />}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}</div>
  );
}

const PW_HINT = 'Optional. At least 12 characters. Leave empty to get a one-time password instead.';

export function SetupForm({ action, templates, done, needsSuperAdmin }: { action: (p: S, d: FormData) => Promise<S>; templates: { value: string; label: string }[]; done: boolean; needsSuperAdmin?: boolean }) {
  const [s, run, pending] = useActionState(action, null);
  // The page re-renders after an action succeeds, so one-time passwords stay on screen from this component's state.
  if (s?.ok) return <pre role="status" className="mt-5 whitespace-pre-wrap rounded-lg border border-line bg-surface p-4 text-sm">{s.ok}</pre>;
  if (done && needsSuperAdmin) return (
    <form action={run} className="mt-5 space-y-3"><input type="hidden" name="mode" value="superadmin" />
      <p className="text-sm">Your organisation exists but has no hidden Super Admin yet. Create one to use the BackEnd.</p>
      <F id="token" label="Setup token" type="password" /><F id="slug" label="Organisation code" def="prince897" />
      <F id="sa" label="Super Admin email" type="email" hint="Use an address that is not already an account in this organisation." />
      <F id="sapw" label="Super Admin password" type="password" req={false} hint={PW_HINT} />
      <p role="alert" className="min-h-5 text-sm text-red-700 dark:text-red-400">{s?.error}</p>
      <button disabled={pending} className="btn-primary w-full">{pending ? 'Creating…' : 'Create Super Admin'}</button></form>
  );
  if (done) return <p role="status" className="mt-5 text-sm">Setup is already complete. <a className="underline" href="/login">Go to sign in</a>.</p>;
  return (
    <form action={run} className="mt-5 space-y-3">
      <F id="token" label="Setup token" type="password" />
      <F id="name" label="Organisation name" def="PRINCE 89.7 FM" />
      <F id="slug" label="Organisation code" def="prince897" hint="Lowercase letters, numbers, dashes. Staff type this when signing in." />
      <div><label className="label" htmlFor="template">Template</label><select id="template" name="template" defaultValue="radio" className="input">{templates.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
      <F id="admin" label="Administrator's name" req={false} />
      <F id="email" label="Administrator's email (the Chairman or IT lead)" type="email" />
      <F id="sa" label="Your hidden Super Admin email (optional)" type="email" req={false} hint="Invisible to the Chairman and staff; used for the BackEnd. Must differ from the administrator's email." />
      <F id="sapw" label="Super Admin password" type="password" req={false} hint={PW_HINT} />
      <p role="alert" className="min-h-5 text-sm text-red-700 dark:text-red-400">{s?.error}</p>
      <button disabled={pending} className="btn-primary w-full">{pending ? 'Creating…' : 'Create organisation'}</button>
    </form>
  );
}
