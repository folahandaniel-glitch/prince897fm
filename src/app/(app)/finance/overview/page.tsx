import Link from 'next/link';
import { page } from '@/server/session';
import { financeOverview } from '@/server/finance';
import { need } from '@/server/ctx';
import { Bars, Money } from '@/components/money';

export const metadata = { title: 'Financial centre' };
export const dynamic = 'force-dynamic';

export default async function FinancialCentre() {
  return page(async (p) => {
    need(p.ctx, 'finance:oversee');
    const o = await financeOverview(p.ctx);
    const k = { cur: o.currency, loc: o.locale };
    const maxTrend = Math.max(1, ...o.trend.flatMap((t) => [t.income, t.expense]));
    return (
      <div className="space-y-6">
        <header><h1 className="text-2xl font-bold">Financial centre</h1><p className="text-sm text-muted">{p.org.name} · {o.today} · every figure comes from the ledger; open a transaction to see its evidence and audit trail.</p></header>

        {(o.exceptions.length > 0 || o.budgets.length > 0) && <section aria-label="Exceptions" className="space-y-2">
          {o.exceptions.map((e, i) => <p key={i} className="rounded-lg border-l-4 border-amber-500 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">{e.id ? <Link className="underline" href={`/finance/${e.id}`}>{e.text}</Link> : e.text}</p>)}
          {o.budgets.map((b) => <p key={b.id} className={`rounded-lg border-l-4 px-4 py-2 text-sm ${b.level === 'over' ? 'border-red-600 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100' : 'border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100'}`}>Budget {b.level === 'over' ? 'exceeded' : 'at ' + b.pct + '%'}: {b.account}{b.department ? ` (${b.department})` : ''}.</p>)}
        </section>}

        <section aria-label="Cash position" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="card !p-4"><p className="text-xs text-muted">Available cash &amp; bank</p><p className="mt-1 text-2xl font-bold"><Money v={o.available} {...k} /></p></div>
          <div className="card !p-4"><p className="text-xs text-muted">Payables (approved, unpaid)</p><p className="mt-1 text-2xl font-bold"><Money v={o.payables} {...k} /></p></div>
          <div className="card !p-4"><p className="text-xs text-muted">Net cash position</p><p className="mt-1 text-2xl font-bold"><Money v={o.net} {...k} /></p></div>
          <div className="card !p-4"><p className="text-xs text-muted">Restricted funds</p><p className="mt-1 text-2xl font-bold"><Money v={o.restricted} {...k} /></p></div>
        </section>

        <section className="card" aria-labelledby="pi"><h2 id="pi" className="font-semibold">Income and expenditure</h2>
          <div className="mt-3 overflow-x-auto"><table className="w-full"><thead><tr className="border-b border-line"><th className="th">Period</th><th className="th text-right">Income</th><th className="th text-right">Expenditure</th><th className="th text-right">Net</th></tr></thead>
            <tbody>{(['today', 'week', 'month', 'year'] as const).map((r) => <tr key={r} className="border-b border-line last:border-0"><td className="td font-medium capitalize">{r === 'today' ? 'Today' : `This ${r}`}</td><td className="td text-right"><Money v={o.periods[r].income} {...k} /></td><td className="td text-right"><Money v={o.periods[r].expense} {...k} /></td><td className="td text-right font-semibold"><Money v={o.periods[r].income - o.periods[r].expense} {...k} /></td></tr>)}</tbody></table></div></section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="card" aria-labelledby="bc"><h2 id="bc" className="font-semibold">Spending by category, this month</h2>{o.byCategory.length === 0 ? <p className="mt-2 text-sm text-muted">No spending posted this month.</p> : <div className="mt-3"><Bars data={o.byCategory} {...k} label="Spending by category" /></div>}</div>
          <div className="card" aria-labelledby="bd"><h2 id="bd" className="font-semibold">Spending by department, this month</h2>{o.byDept.length === 0 ? <p className="mt-2 text-sm text-muted">No spending posted this month.</p> : <div className="mt-3"><Bars data={o.byDept} {...k} label="Spending by department" /></div>}</div>
        </section>

        <section className="card" aria-labelledby="tr"><h2 id="tr" className="font-semibold">Six-month trend</h2>
          <div className="mt-3 flex h-40 items-end gap-3" role="img" aria-label={`Monthly income and expense: ${o.trend.map((t) => `${t.month} income ${t.income / 100}, expense ${t.expense / 100}`).join('; ')}`}>
            {o.trend.map((t) => <div key={t.month} className="flex flex-1 flex-col items-center gap-1" aria-hidden><div className="flex h-32 w-full items-end justify-center gap-1"><div className="w-1/3 bg-brand-2" style={{ height: `${Math.max(2, (t.income / maxTrend) * 100)}%` }} /><div className="w-1/3 bg-accent" style={{ height: `${Math.max(2, (t.expense / maxTrend) * 100)}%` }} /></div><span className="text-xs text-muted">{t.month.slice(5)}</span></div>)}</div>
          <p className="mt-2 text-xs text-muted"><span className="inline-block h-2 w-2 bg-brand-2" /> Income &nbsp; <span className="inline-block h-2 w-2 bg-accent" /> Expenditure</p></section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="card" aria-labelledby="ap"><h2 id="ap" className="font-semibold">Waiting for action</h2>
            <p className="mt-2 text-sm"><strong>{o.pending.review}</strong> awaiting review · <strong>{o.pending.approval}</strong> awaiting approval · <strong>{o.pending.toPay}</strong> approved, unpaid</p>
            <p className="text-sm text-muted">Total value in the pipeline: <Money v={o.pending.value} {...k} /></p><Link href="/finance" className="mt-2 inline-block text-sm underline">Open the finance desk</Link></div>
          <div className="card" aria-labelledby="hv"><h2 id="hv" className="font-semibold">High-value transactions</h2>
            {o.big.length === 0 ? <p className="mt-2 text-sm text-muted">None above the top approval threshold.</p> : <ul className="mt-2 divide-y divide-line text-sm">{o.big.map((r: any) => <li key={r.id}><Link href={`/finance/${r.id}`} className="flex justify-between gap-2 py-1.5 hover:underline"><span>{r.number} {r.title}</span><Money v={r.amountMinor} {...k} /></Link></li>)}</ul>}</div>
        </section>

        <section className="card" aria-labelledby="ca"><h2 id="ca" className="font-semibold">Cash and bank accounts</h2>
          <ul className="mt-2 divide-y divide-line text-sm">{o.cashAccts.map((a) => <li key={a.name} className="flex justify-between py-1.5"><span>{a.name}{a.restricted ? ' (restricted)' : ''}</span><Money v={a.balance} {...k} /></li>)}</ul></section>
      </div>
    );
  });
}
