import Link from 'next/link';
import { page } from '@/server/session';
import { incomeExpense, ledger, trialBalance } from '@/server/finance';
import { need } from '@/server/ctx';
import { Money } from '@/components/money';

export const metadata = { title: 'Ledger & reports' };
export const dynamic = 'force-dynamic';

export default async function FinanceReports({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  return page(async (p) => {
    need(p.ctx, 'finance:view');
    const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : new Date().toISOString().slice(0, 10);
    const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : `${to.slice(0, 4)}-01-01`;
    const [ie, tb, gl] = await Promise.all([incomeExpense(p.ctx, from, to), trialBalance(p.ctx, to), ledger(p.ctx, undefined, 40)]);
    const k = { cur: p.org.currency, loc: p.org.locale };
    const D = (v: unknown) => Number(v) > 0 ? Number(v).toLocaleString(p.org.locale, { minimumFractionDigits: 2 }) : '';
    return (
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3"><h1 className="text-2xl font-bold">Ledger &amp; reports</h1>
          <form className="flex flex-wrap items-end gap-2"><div><label className="label" htmlFor="from">From</label><input id="from" name="from" type="date" defaultValue={from} className="input" /></div><div><label className="label" htmlFor="to">To</label><input id="to" name="to" type="date" defaultValue={to} className="input" /></div><button className="btn-ghost">Apply</button>
            {p.allowed('finance:export') && <a className="btn-ghost" href={`/api/finance/export?from=${from}&to=${to}`}>Export transactions (CSV)</a>}</form></header>
        <p className="text-sm text-muted">Management reports from the ledger. These are not audited statutory accounts.</p>

        <section className="card" aria-labelledby="ie"><h2 id="ie" className="font-semibold">Income and expenditure, {from} to {to}</h2>
          <table className="mt-3 w-full"><thead><tr className="border-b border-line"><th className="th">Account</th><th className="th text-right">Amount</th></tr></thead>
            <tbody>{ie.lines.map((l) => <tr key={l.code} className="border-b border-line"><td className="td">{l.code} · {l.name} <span className="badge">{l.type}</span></td><td className="td text-right"><Money v={l.amount} {...k} /></td></tr>)}
              <tr><td className="td font-semibold">Total income</td><td className="td text-right font-semibold"><Money v={ie.income} {...k} /></td></tr><tr><td className="td font-semibold">Total expenditure</td><td className="td text-right font-semibold"><Money v={ie.expense} {...k} /></td></tr>
              <tr className="border-t-2 border-line"><td className="td font-bold">Surplus / (deficit)</td><td className="td text-right font-bold"><Money v={ie.net} {...k} /></td></tr></tbody></table></section>

        <section className="card overflow-x-auto" aria-labelledby="tb"><h2 id="tb" className="font-semibold">Trial balance as at {to}</h2>
          <table className="mt-3 w-full min-w-[28rem]"><thead><tr className="border-b border-line"><th className="th">Account</th><th className="th text-right">Debit</th><th className="th text-right">Credit</th></tr></thead>
            <tbody>{tb.lines.filter((l) => l.debit || l.credit).map((l) => <tr key={l.code} className="border-b border-line"><td className="td">{l.code} · {l.name}</td><td className="td text-right tabular-nums">{D(l.debit / 100)}</td><td className="td text-right tabular-nums">{D(l.credit / 100)}</td></tr>)}
              <tr className="border-t-2 border-line font-bold"><td className="td">Totals {tb.totalDebit === tb.totalCredit ? '(balanced)' : '(OUT OF BALANCE)'}</td><td className="td text-right"><Money v={tb.totalDebit} {...k} /></td><td className="td text-right"><Money v={tb.totalCredit} {...k} /></td></tr></tbody></table></section>

        <section className="card overflow-x-auto" aria-labelledby="gl"><h2 id="gl" className="font-semibold">Recent journal lines</h2>
          <table className="mt-3 w-full min-w-[40rem]"><thead><tr className="border-b border-line"><th className="th">#</th><th className="th">Date</th><th className="th">Account</th><th className="th">Memo</th><th className="th text-right">Debit</th><th className="th text-right">Credit</th></tr></thead>
            <tbody>{gl.map((r: any, i: number) => <tr key={i} className="border-b border-line last:border-0"><td className="td">{r.entry_no}</td><td className="td">{r.d}</td><td className="td">{r.code} {r.name}</td><td className="td">{r.txn_id ? <Link className="underline" href={`/finance/${r.txn_id}`}>{r.txn_number}</Link> : r.memo}</td><td className="td text-right tabular-nums">{D(r.debit)}</td><td className="td text-right tabular-nums">{D(r.credit)}</td></tr>)}</tbody></table></section>
      </div>
    );
  });
}
