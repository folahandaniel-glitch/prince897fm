import { page, mutate, field } from '@/server/session';
import { addAccount, listAccounts, listBands, listPeriods, postManual, saveBand, setPeriod } from '@/server/finance';
import { need } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';
import { Money } from '@/components/money';

export const metadata = { title: 'Finance setup' };
export const dynamic = 'force-dynamic';

async function account(_p: unknown, f: FormData) { 'use server'; return mutate(['/finance/setup'], async (c) => { await addAccount(c, { code: field(f, 'code'), name: field(f, 'name'), type: field(f, 'type'), isCash: field(f, 'cash') === 'on', restricted: field(f, 'restricted') === 'on' }); return 'Account added.'; }); }
async function band(_p: unknown, f: FormData) { 'use server'; return mutate(['/finance/setup'], async (c) => { await saveBand(c, field(f, 'min'), [field(f, 's1'), field(f, 's2'), field(f, 's3')].filter(Boolean)); return 'Approval band saved.'; }); }
async function period(_p: unknown, f: FormData) {
  'use server'; const [y, m] = field(f, 'month').split('-').map(Number); const close = field(f, 'intent') === 'close';
  return mutate(['/finance/setup'], async (c) => { await setPeriod(c, y, m, close, field(f, 'reason')); return close ? 'Period closed.' : 'Period reopened.'; });
}
async function manual(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/finance/setup', '/finance/reports'], async (c) => {
    const lines = [1, 2, 3, 4].map((n) => ({ accountId: field(f, `a${n}`), debit: field(f, `d${n}`), credit: field(f, `c${n}`) }));
    return `Entry #${await postManual(c, { date: field(f, 'date'), memo: field(f, 'memo'), lines })} posted.`;
  });
}

export default async function FinanceSetup() {
  return page(async (p) => {
    need(p.ctx, 'finance:configure');
    const [accts, bands, periods, roles] = await Promise.all([listAccounts(p.ctx.q), listBands(p.ctx.q), listPeriods(p.ctx.q), p.ctx.q.query<any>('select key, name from roles order by name')]);
    const k = { cur: p.org.currency, loc: p.org.locale };
    const roleOpts = roles.map((r: any) => ({ value: r.key, label: r.name }));
    const acctOpts = accts.filter((a: any) => a.active).map((a: any) => ({ value: a.id, label: `${a.code} · ${a.name}` }));
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Finance setup</h1>
        <section className="card" aria-labelledby="bands"><h2 id="bands" className="font-semibold">Approval bands</h2>
          <p className="text-sm text-muted">The highest band an amount reaches decides who must approve, in order. The same person can never approve two stages, or approve what they created, reviewed or will pay.</p>
          <ul className="mt-2 divide-y divide-line text-sm">{bands.map((b) => <li key={b.id} className="flex flex-wrap justify-between gap-2 py-2"><span>From <Money v={b.minAmount} {...k} /></span><span>{b.steps.map((s) => roles.find((r: any) => r.key === s)?.name ?? s).join(' → ')}</span></li>)}</ul>
          <ActionForm action={band as any} submit="Save band" className="mt-3 border-t border-line pt-3"><div className="grid gap-x-4 sm:grid-cols-4"><Field label="From amount (₦)" name="min" required placeholder="500,000" /><Select label="Stage 1" name="s1" required allowEmpty={false} defaultValue="finance_manager" options={roleOpts} /><Select label="Stage 2" name="s2" options={roleOpts} /><Select label="Stage 3" name="s3" options={roleOpts} /></div><p className="text-xs text-muted">Saving a band with an existing &ldquo;from&rdquo; amount replaces its approvers. Use 0 for the base band.</p></ActionForm></section>

        <section className="card" aria-labelledby="coa"><h2 id="coa" className="font-semibold">Chart of accounts</h2>
          <ul className="mt-2 grid gap-x-6 text-sm sm:grid-cols-2">{accts.map((a: any) => <li key={a.id} className="flex justify-between border-b border-line py-1.5"><span>{a.code} · {a.name}</span><span className="text-muted">{a.type}{a.is_cash ? ' · cash/bank' : ''}{a.restricted ? ' · restricted' : ''}</span></li>)}</ul>
          <ActionForm action={account as any} submit="Add account" tone="ghost" className="mt-3 border-t border-line pt-3"><div className="grid gap-x-4 sm:grid-cols-4"><Field label="Code" name="code" required placeholder="5070" /><Field label="Name" name="name" required />
            <Select label="Type" name="type" allowEmpty={false} defaultValue="expense" options={['asset', 'liability', 'equity', 'income', 'expense'].map((x) => ({ value: x, label: x }))} />
            <div className="mt-6 space-y-1 text-sm"><label className="flex items-center gap-2"><input type="checkbox" name="cash" className="h-5 w-5" /> Cash or bank</label><label className="flex items-center gap-2"><input type="checkbox" name="restricted" className="h-5 w-5" /> Restricted funds</label></div></div></ActionForm></section>

        <section className="card" aria-labelledby="per"><h2 id="per" className="font-semibold">Accounting periods</h2>
          <p className="text-sm text-muted">Closing a month blocks any posting dated in it. Reopening needs a reason and is audited.</p>
          <ul className="mt-2 text-sm">{periods.map((x: any) => <li key={`${x.year}-${x.month}`} className="flex justify-between py-1"><span>{x.year}-{String(x.month).padStart(2, '0')}</span><span className="badge">{x.status}</span></li>)}{periods.length === 0 && <li className="text-muted">All periods are open.</li>}</ul>
          <ActionForm action={period as any} submit="Close" className="mt-3" buttons={[{ label: 'Close month', value: 'close' }, { label: 'Reopen month', value: 'open', tone: 'ghost' }]}><div className="grid gap-x-4 sm:grid-cols-2"><Field label="Month" name="month" type="month" required /><Field label="Reason (required to reopen)" name="reason" /></div></ActionForm></section>

        <section className="card" aria-labelledby="man"><h2 id="man" className="font-semibold">Manual journal entry</h2>
          <p className="text-sm text-muted">For corrections and opening balances only. Needs a clear explanation, must balance, and is flagged in the audit trail.</p>
          <ActionForm action={manual as any} submit="Post entry" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-2"><Field label="Date" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /><Field label="Explanation" name="memo" required /></div>
            {[1, 2, 3, 4].map((n) => <div key={n} className="mb-2 grid gap-2 sm:grid-cols-[1fr_9rem_9rem]"><select name={`a${n}`} aria-label={`Account ${n}`} className="input" defaultValue=""><option value="">— account {n} —</option>{acctOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select><input name={`d${n}`} aria-label={`Debit ${n}`} className="input" placeholder="Debit" /><input name={`c${n}`} aria-label={`Credit ${n}`} className="input" placeholder="Credit" /></div>)}</ActionForm></section>
      </div>
    );
  });
}
