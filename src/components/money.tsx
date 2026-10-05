import { formatMoney } from '@/domain/finance';

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', submitted: 'Awaiting review', reviewed: 'Awaiting approval', approved: 'Approved: ready to pay', paid: 'Paid', posted: 'Posted', reconciled: 'Reconciled', rejected: 'Rejected', void: 'Void',
};
const TONE: Record<string, string> = {
  approved: 'bg-sky-100 text-sky-900', paid: 'bg-indigo-100 text-indigo-900', posted: 'bg-indigo-100 text-indigo-900', reconciled: 'bg-emerald-100 text-emerald-900',
  rejected: 'bg-red-100 text-red-900', void: 'bg-red-100 text-red-900', submitted: 'bg-amber-100 text-amber-900', reviewed: 'bg-amber-100 text-amber-900',
};

export const Money = ({ v, cur = 'NGN', loc = 'en-NG', className = '' }: { v: number; cur?: string; loc?: string; className?: string }) =>
  <span className={`tabular-nums ${v < 0 ? 'text-red-700 dark:text-red-400' : ''} ${className}`}>{formatMoney(v, cur, loc)}</span>;

export const StatusBadge = ({ s }: { s: string }) => <span className={`badge ${TONE[s] ?? ''}`}>{STATUS_LABEL[s] ?? s}</span>;

/** Compact bar chart with an accessible text alternative (data table inside <details>). */
export function Bars({ data, cur, loc, label }: { data: { name: string; amount: number }[]; cur?: string; loc?: string; label: string }) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.amount)));
  return (
    <div role="img" aria-label={`${label}: ${data.map((d) => `${d.name} ${formatMoney(d.amount, cur, loc)}`).join(', ')}`}>
      <ul className="space-y-2" aria-hidden>
        {data.map((d) => (
          <li key={d.name} className="text-sm"><div className="flex justify-between gap-2"><span className="truncate">{d.name}</span><Money v={d.amount} cur={cur} loc={loc} /></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface"><div className="h-full bg-brand-2" style={{ width: `${Math.max(2, (Math.abs(d.amount) / max) * 100)}%` }} /></div></li>))}
      </ul>
    </div>
  );
}
