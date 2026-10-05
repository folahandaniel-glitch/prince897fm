import Link from 'next/link';

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0"><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>{sub && <p className="mt-1 text-sm text-muted">{sub}</p>}</div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function Empty({ title, text, href, action }: { title: string; text?: string; href?: string; action?: string }) {
  return (
    <div className="card text-center">
      <p className="font-semibold">{title}</p>
      {text && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{text}</p>}
      {href && action && <Link href={href} className="btn-primary mt-3">{action}</Link>}
    </div>
  );
}

export function Stat({ label, value, sub, href }: { label: string; value: React.ReactNode; sub?: string; href?: string }) {
  const body = <><p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums sm:text-3xl">{value}</p>{sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}</>;
  return href ? <Link href={href} className="stat block transition hover:-translate-y-0.5 hover:border-brand hover:shadow-md">{body}</Link> : <div className="stat">{body}</div>;
}

export const Notice = ({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'bad'; children: React.ReactNode }) => (
  <p role="note" className={`rounded-xl border-l-4 px-4 py-3 text-sm ${tone === 'bad' ? 'border-red-600 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100' : tone === 'warn' ? 'border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100' : 'border-brand-2 bg-surface'}`}>{children}</p>
);
