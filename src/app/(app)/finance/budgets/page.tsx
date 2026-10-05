import { page, mutate, field, optional } from '@/server/session';
import { budgetVsActual, listAccounts, setBudget } from '@/server/finance';
import { listStructure } from '@/server/hr';
import { need } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';
import { Money } from '@/components/money';

export const metadata = { title: 'Budgets' };
export const dynamic = 'force-dynamic';

async function save(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/finance/budgets'], async (c) => { await setBudget(c, { year: Number(field(f, 'year')), accountId: field(f, 'accountId'), departmentId: optional(f, 'departmentId'), amount: field(f, 'amount') }); return 'Budget saved. The change is recorded in the audit trail.'; });
}
const BAR: Record<string, string> = { ok: 'bg-brand-2', warning: 'bg-amber-500', over: 'bg-red-600' };

export default async function Budgets() {
  return page(async (p) => {
    need(p.ctx, 'finance:view');
    const year = new Date().getUTCFullYear();
    const [rows, accts, st] = await Promise.all([budgetVsActual(p.ctx, year), listAccounts(p.ctx.q), listStructure(p.ctx.q)]);
    const k = { cur: p.org.currency, loc: p.org.locale };
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Budgets {year}</h1>
        {rows.length === 0 ? <div className="card text-center"><p className="font-semibold">No budgets set for {year}</p><p className="mt-1 text-sm text-muted">Budgets are set against expense accounts, optionally per department.</p></div> :
          <div className="card overflow-x-auto p-0"><table className="w-full min-w-[40rem]"><thead><tr className="border-b border-line"><th className="th">Account</th><th className="th">Department</th><th className="th text-right">Budget</th><th className="th text-right">Spent</th><th className="th text-right">Remaining</th><th className="th">Used</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id} className="border-b border-line last:border-0"><td className="td">{r.code} · {r.account}</td><td className="td">{r.department ?? 'All'}</td><td className="td text-right"><Money v={r.budget} {...k} /></td><td className="td text-right"><Money v={r.spent} {...k} /></td><td className="td text-right"><Money v={r.remaining} {...k} /></td>
              <td className="td"><div className="flex items-center gap-2"><div className="h-2 w-24 overflow-hidden rounded-full bg-surface" role="img" aria-label={`${r.pct}% used`}><div className={`h-full ${BAR[r.level]}`} style={{ width: `${Math.min(100, r.pct)}%` }} /></div><span className="text-xs">{r.pct}%{r.level === 'over' ? ' over' : ''}</span></div></td></tr>)}</tbody></table></div>}
        {p.allowed('finance:configure') && <section className="card" aria-labelledby="sb"><h2 id="sb" className="font-semibold">Set or change a budget</h2>
          <ActionForm action={save as any} submit="Save budget" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-4"><Field label="Year" name="year" type="number" required defaultValue={String(year)} />
            <Select label="Expense account" name="accountId" required allowEmpty={false} options={accts.filter((a: any) => a.type === 'expense').map((a: any) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
            <Select label="Department (optional)" name="departmentId" options={st.departments.filter((d: any) => !d.archived_at).map((d: any) => ({ value: d.id, label: d.name }))} /><Field label="Amount (₦)" name="amount" required /></div></ActionForm></section>}
      </div>
    );
  });
}
