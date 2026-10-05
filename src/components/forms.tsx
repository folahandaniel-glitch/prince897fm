'use client';
import { useActionState } from 'react';
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

export function Field({ label, name, type = 'text', required, defaultValue, placeholder, hint, autoComplete }: {
  label: string; name: string; type?: string; required?: boolean; defaultValue?: string; placeholder?: string; hint?: string; autoComplete?: string;
}) {
  return (
    <div className="mb-3">
      <label className="label" htmlFor={name}>{label}{required && <span aria-hidden> *</span>}</label>
      <input id={name} name={name} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder} autoComplete={autoComplete} className="input" aria-describedby={hint ? `${name}-hint` : undefined} />
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
