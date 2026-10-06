'use client';
import { useActionState, useState } from 'react';
import type { FormState } from '@/server/session';

type Action = (prev: FormState, data: FormData) => Promise<FormState>;

/** Server-action form with accessible success/error feedback and a pending state. */
export function ActionForm({ action, children, submit, tone = 'primary', className = '', confirm, buttons }: {
  action: Action; children: React.ReactNode; submit: string; tone?: 'primary' | 'danger' | 'ghost'; className?: string; confirm?: string;
  /** Optional extra/alternative submit buttons; each sends its value as the "intent" field. */
  buttons?: { label: string; value: string; tone?: 'primary' | 'danger' | 'ghost' }[];
}) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className={className} onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {(buttons ?? [{ label: submit, value: '', tone }]).map((b) => (
          <button key={b.label} type="submit" name={b.value ? 'intent' : undefined} value={b.value || undefined} disabled={pending} className={b.tone === 'danger' ? 'btn-danger' : b.tone === 'ghost' ? 'btn-ghost' : 'btn-primary'}>
            {pending ? 'Working…' : b.label}
          </button>
        ))}
        <p role="status" aria-live="polite" className={`text-sm ${state?.error ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
          {state?.error ?? state?.ok ?? ''}
        </p>
      </div>
    </form>
  );
}

/** A password box with a show/hide button. Drop-in for <input type="password">. */
export function PasswordInput({ id, name, required, autoComplete, minLength, className = 'input', defaultValue }: { id: string; name: string; required?: boolean; autoComplete?: string; minLength?: number; className?: string; defaultValue?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input id={id} name={name} type={show ? 'text' : 'password'} required={required} autoComplete={autoComplete} minLength={minLength} defaultValue={defaultValue} className={`${className} pr-12`} />
      <button type="button" onClick={() => setShow((v) => !v)} aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-surface">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{show ? <><path d="M3 3l18 18" /><path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c5 0 8.5 4.2 9.5 6-.4.8-1.3 2.1-2.7 3.3M6.4 7.7C4.4 9 3 11 2.5 12c1 1.8 4.5 6 9.5 6 1.5 0 2.8-.4 4-1M9.9 9.9a3 3 0 0 0 4.2 4.2" /></> : <><path d="M2.5 12C3.5 10.2 7 6 12 6s8.5 4.2 9.5 6c-1 1.8-4.5 6-9.5 6s-8.5-4.2-9.5-6z" /><circle cx="12" cy="12" r="3" /></>}</svg>
      </button>
    </div>
  );
}

export function Field({ label, name, type = 'text', required, defaultValue, placeholder, hint, autoComplete }: {
  label: string; name: string; type?: string; required?: boolean; defaultValue?: string; placeholder?: string; hint?: string; autoComplete?: string;
}) {
  return (
    <div className="mb-3">
      <label className="label" htmlFor={name}>{label}{required && <span aria-hidden> *</span>}</label>
      {type === 'password' ? <PasswordInput id={name} name={name} required={required} autoComplete={autoComplete} defaultValue={defaultValue} /> : <input id={name} name={name} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder} autoComplete={autoComplete} className="input" aria-describedby={hint ? `${name}-hint` : undefined} />}
      {hint && <p id={`${name}-hint`} className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Select({ label, name, options, defaultValue, allowEmpty = true, required }: {
  label: string; name: string; options: { value: string; label: string }[]; defaultValue?: string | null; allowEmpty?: boolean; required?: boolean;
}) {
  return (
    <div className="mb-3">
      <label className="label" htmlFor={name}>{label}{required && <span aria-hidden> *</span>}</label>
      <select id={name} name={name} className="input" defaultValue={defaultValue ?? ''} required={required}>
        {allowEmpty && <option value="">— none —</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
