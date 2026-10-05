import { page, mutate, field } from '@/server/session';
import { bankWorkbench, ignoreBankLine, importBankStatement, matchBankLine } from '@/server/invoices';
import { listAccounts } from '@/server/finance';
import { need } from '@/server/ctx';
import { ActionForm } from '@/components/forms';
import { Money } from '@/components/money';
import { Notice } from '@/components/ui';

export const metadata = { title: 'Bank reconciliation' };
export const dynamic = 'force-dynamic';

async function upload(_p: unknown, f: FormData) {
  'use server';
  const file = f.get('file');
  const text = file instanceof File && file.size > 0 ? await file.text() : field(f, 'csv');
  return mutate(['/finance/bank'], async (c) => {
    const r = await importBankStatement(c, field(f, 'account'), text);
    return `Imported ${r.added} line(s)${r.duplicates ? `, ${r.duplicates} already imported` : ''}${r.errors.length ? `. Skipped: ${r.errors.slice(0, 3).join(' ')}` : ''}.`;
  });
}
async function act(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/finance/bank'], async (c) => {
    if (field(f, 'intent') === 'ignore') { await ignoreBankLine(c, field(f, 'line')); return 'Ignored.'; }
    await matchBankLine(c, field(f, 'line'), { kind: field(f, 'kind') as 'txn' | 'payment', id: field(f, 'target') });
    return 'Matched.';
  });
}

export default async function Bank({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const sp = await searchParams;
  return page(async (p) => {
    p.requireFeature('finance');
    need(p.ctx, 'finance:reconcile');
    const accts = (await listAccounts(p.ctx.q)).filter((a: any) => a.is_cash && a.active);
    const acct = accts.find((a: any) => a.id === sp.account) ?? accts.find((a: any) => a.code === '1010') ?? accts[0];
    const lines = acct ? await bankWorkbench(p.ctx, acct.id) : [];
    const k = { cur: p.org.currency, loc: p.org.locale };
    const open = lines.filter((l) => l.status === 'unmatched');
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-bold">Bank reconciliation</h1>
        <Notice>Import your bank statement as CSV (headers like Date, Description, Reference and either Amount or Debit and Credit). Lines are matched to paid transactions and receipts by identical amount and a close date. Matching a transaction reconciles it, and the usual separation of duties applies.</Notice>
        <form className="card flex flex-wrap items-end gap-2" role="search"><div><label className="label" htmlFor="account">Account</label><select id="account" name="account" defaultValue={acct?.id} className="input">{accts.map((a: any) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></div><button className="btn-ghost">Show</button></form>
        {acct && <section className="card"><h2 className="font-semibold">Import a statement into {acct.name}</h2>
          <ActionForm action={upload as any} submit="Import" className="mt-3"><input type="hidden" name="account" value={acct.id} />
            <div className="mb-3"><label className="label" htmlFor="file">CSV file</label><input id="file" name="file" type="file" accept=".csv,text/csv" className="input py-2" /></div>
            <div className="mb-1"><label className="label" htmlFor="csv">…or paste CSV text</label><textarea id="csv" name="csv" rows={4} className="input py-2 font-mono text-xs" placeholder={'Date,Description,Reference,Debit,Credit\n2026-03-02,Transfer to vendor,GTB-77821,150000.00,'} /></div></ActionForm></section>}
        <section className="card overflow-x-auto"><h2 className="font-semibold">Statement lines <span className="text-muted">({open.length} unmatched)</span></h2>
          {lines.length === 0 ? <p className="mt-2 text-sm text-muted">No statement lines yet.</p> : (
            <table className="mt-2 w-full min-w-[44rem]"><thead><tr className="border-b border-line"><th className="th">Date</th><th className="th">Description</th><th className="th text-right">Amount</th><th className="th">Status</th><th className="th">Action</th></tr></thead>
              <tbody>{lines.map((l) => <tr key={l.id} className="border-b border-line align-top last:border-0"><td className="td">{l.date}</td><td className="td">{l.description || '–'}<span className="block text-xs text-muted">{l.reference}</span></td><td className="td text-right"><Money v={l.amount} {...k} /></td><td className="td">{l.status}</td>
                <td className="td">{l.status === 'unmatched' && <ActionForm action={act as any} submit="" className="!mt-0" buttons={[...(l.suggestion ? [{ label: `Match ${l.suggestion.label}`, value: 'match' }] : []), { label: 'Ignore', value: 'ignore', tone: 'ghost' as const }]}>
                  <input type="hidden" name="line" value={l.id} />{l.suggestion && <><input type="hidden" name="kind" value={l.suggestion.kind} /><input type="hidden" name="target" value={l.suggestion.id} /></>}</ActionForm>}</td></tr>)}</tbody></table>)}</section>
      </div>
    );
  });
}
