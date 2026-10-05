import Link from 'next/link';
import { page } from '@/server/session';
import { listTransactions, workQueues } from '@/server/finance';
import { need } from '@/server/ctx';
import { Money, StatusBadge } from '@/components/money';

export const metadata = { title: 'Finance desk' };
export const dynamic = 'force-dynamic';

const Q = ({ title, rows, empty, cur, loc }: { title: string; rows: any[]; empty: string; cur: string; loc: string }) => (
  <section className="card" aria-label={title}><h2 className="font-semibold">{title} <span className="text-muted">({rows.length})</span></h2>
    {rows.length === 0 ? <p className="mt-2 text-sm text-muted">{empty}</p> : <ul className="mt-2 divide-y divide-line text-sm">{rows.slice(0, 8).map((r) => (
      <li key={r.id}><Link href={`/finance/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:underline"><span><strong>{r.number}</strong> {r.title}</span><Money v={r.amountMinor} cur={cur} loc={loc} /></Link></li>))}</ul>}</section>
);

export default async function FinanceDesk({ searchParams }: { searchParams: Promise<{ status?: string; kind?: string; q?: string }> }) {
  const sp = await searchParams;
  return page(async (p) => {
    need(p.ctx, 'finance:view');
    const [queues, list] = await Promise.all([workQueues(p.ctx), listTransactions(p.ctx, { status: sp.status, kind: sp.kind, q: sp.q, limit: 60 })]);
    const k = { cur: p.org.currency, loc: p.org.locale };
    return (
      <div className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">Finance desk</h1>
          {p.allowed('finance:create') && <Link href="/finance/new" className="btn-primary">New transaction</Link>}</header>
        <p className="text-sm text-muted">Management accounting on a double-entry ledger. Each step below is waiting for <em>you</em>; steps you cannot take because of separation of duties are not shown.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <Q title="To review" rows={queues.review} empty="Nothing waiting for your review." {...k} />
          <Q title="To approve" rows={queues.approve} empty="Nothing waiting for your approval." {...k} />
          <Q title="To pay" rows={queues.pay} empty="No approved payments waiting." {...k} />
          <Q title="To reconcile" rows={queues.reconcile} empty="Nothing waiting to be reconciled." {...k} />
        </div>
        <section className="card" aria-labelledby="all"><h2 id="all" className="font-semibold">Transactions</h2>
          <form className="mt-3 flex flex-wrap items-end gap-2" role="search">
            <div><label className="label" htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q} className="input" placeholder="Number or title" /></div>
            <div><label className="label" htmlFor="status">Status</label><select id="status" name="status" className="input" defaultValue={sp.status ?? ''}><option value="">Any</option>{['draft', 'submitted', 'reviewed', 'approved', 'paid', 'posted', 'reconciled', 'rejected', 'void'].map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
            <div><label className="label" htmlFor="kind">Type</label><select id="kind" name="kind" className="input" defaultValue={sp.kind ?? ''}><option value="">Any</option><option value="expense">Expense</option><option value="income">Income</option><option value="transfer">Transfer</option></select></div>
            <button className="btn-ghost">Filter</button></form>
          {list.length === 0 ? <div className="mt-4 rounded-lg border border-line p-6 text-center"><p className="font-semibold">No transactions yet</p><p className="mt-1 text-sm text-muted">Record the first expense, income or transfer to start the ledger.</p>{p.allowed('finance:create') && <Link href="/finance/new" className="btn-primary mt-3">New transaction</Link>}</div> : (
            <div className="mt-3 overflow-x-auto"><table className="w-full"><thead><tr className="border-b border-line"><th className="th">No.</th><th className="th">Date</th><th className="th">Title</th><th className="th">Category</th><th className="th text-right">Amount</th><th className="th">Status</th></tr></thead>
              <tbody>{list.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface"><td className="td"><Link className="font-medium underline" href={`/finance/${r.id}`}>{r.number}</Link></td><td className="td">{r.d}</td><td className="td">{r.title}</td><td className="td">{r.category}</td>
                  <td className="td text-right"><Money v={r.kind === 'income' ? r.amountMinor : r.amountMinor} {...k} /></td><td className="td"><StatusBadge s={r.status} /></td></tr>))}</tbody></table></div>)}
        </section>
      </div>
    );
  });
}
