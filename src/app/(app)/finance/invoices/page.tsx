import Link from 'next/link';
import { page } from '@/server/session';
import { listInvoices } from '@/server/invoices';
import { need } from '@/server/ctx';
import { Money } from '@/components/money';
import { Empty } from '@/components/ui';

export const metadata = { title: 'Invoices & bills' };
export const dynamic = 'force-dynamic';

const TONE: Record<string, string> = { pending: 'bg-amber-100 text-amber-900', open: 'bg-sky-100 text-sky-900', paid: 'bg-emerald-100 text-emerald-900', void: 'bg-red-100 text-red-900' };
const LABEL: Record<string, string> = { pending: 'Awaiting approval', open: 'Open', paid: 'Paid', void: 'Void' };

export default async function Invoices({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const sp = await searchParams;
  const kind = sp.kind === 'payable' ? 'payable' : 'receivable';
  return page(async (p) => {
    p.requireFeature('finance');
    need(p.ctx, 'finance:view');
    const rows = await listInvoices(p.ctx, kind);
    const k = { cur: p.org.currency, loc: p.org.locale };
    const today = new Date().toISOString().slice(0, 10);
    return (
      <div className="space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">Invoices &amp; bills</h1>
          {p.allowed('finance:create') && <Link href={`/finance/invoices/new?kind=${kind}`} className="btn-primary">{kind === 'receivable' ? 'New invoice' : 'Record a bill'}</Link>}</header>
        <nav aria-label="Type" className="flex gap-2"><Link href="/finance/invoices?kind=receivable" className={kind === 'receivable' ? 'btn-primary' : 'btn-ghost'}>Owed to us (receivables)</Link><Link href="/finance/invoices?kind=payable" className={kind === 'payable' ? 'btn-primary' : 'btn-ghost'}>We owe (payables)</Link><Link href="/finance/ageing" className="btn-ghost">Ageing</Link></nav>
        {rows.length === 0 ? <Empty title="Nothing here yet" text={kind === 'receivable' ? 'Raise an invoice for a client to start tracking what is owed to you.' : 'Record a vendor bill to track what you owe.'} /> : (
          <div className="card overflow-x-auto p-0"><table className="w-full min-w-[40rem]"><thead><tr className="border-b border-line"><th className="th">No.</th><th className="th">{kind === 'receivable' ? 'Client' : 'Vendor'}</th><th className="th">Due</th><th className="th text-right">Total</th><th className="th text-right">Balance</th><th className="th">Status</th></tr></thead>
            <tbody>{rows.map((r: any) => <tr key={r.id} className="border-b border-line last:border-0"><td className="td"><Link className="font-medium underline" href={`/finance/invoices/${r.id}`}>{r.number}</Link></td><td className="td">{r.party}</td>
              <td className={`td ${r.status === 'open' && r.due < today ? 'font-semibold text-red-700 dark:text-red-400' : ''}`}>{r.due}{r.status === 'open' && r.due < today ? ' (overdue)' : ''}</td><td className="td text-right"><Money v={r.totalMinor} {...k} /></td><td className="td text-right"><Money v={r.status === 'void' ? 0 : r.balanceMinor} {...k} /></td><td className="td"><span className={`badge ${TONE[r.status] ?? ''}`}>{LABEL[r.status] ?? r.status}</span></td></tr>)}</tbody></table></div>)}
      </div>
    );
  });
}
