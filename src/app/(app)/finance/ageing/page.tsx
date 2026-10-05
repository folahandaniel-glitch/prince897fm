import Link from 'next/link';
import { page } from '@/server/session';
import { ageing } from '@/server/invoices';
import { need } from '@/server/ctx';
import { Money } from '@/components/money';

export const metadata = { title: 'Ageing' };
export const dynamic = 'force-dynamic';

export default async function Ageing() {
  return page(async (p) => {
    p.requireFeature('finance');
    need(p.ctx, 'finance:view');
    const [rec, pay] = await Promise.all([ageing(p.ctx, 'receivable'), ageing(p.ctx, 'payable')]);
    const k = { cur: p.org.currency, loc: p.org.locale };
    const Table = ({ title, a, who }: { title: string; a: typeof rec; who: string }) => (
      <section className="card overflow-x-auto"><h2 className="font-semibold">{title} <span className="text-muted">as at {a.asOf}</span></h2>
        {a.rows.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing outstanding.</p> : (
          <table className="mt-2 w-full min-w-[40rem]"><thead><tr className="border-b border-line"><th className="th">{who}</th>{a.labels.map((l) => <th key={l} className="th text-right">{l}</th>)}<th className="th text-right">Total</th></tr></thead>
            <tbody>{a.rows.map((r) => <tr key={r.party} className="border-b border-line"><td className="td">{r.party}</td>{r.buckets.map((b, i) => <td key={i} className="td text-right">{b ? <Money v={b} {...k} /> : '–'}</td>)}<td className="td text-right font-semibold"><Money v={r.total} {...k} /></td></tr>)}
              <tr className="font-semibold"><td className="td">Total</td>{a.totals.map((b, i) => <td key={i} className="td text-right"><Money v={b} {...k} /></td>)}<td className="td text-right"><Money v={a.grand} {...k} /></td></tr></tbody></table>)}</section>
    );
    return (
      <div className="space-y-5">
        <header className="flex items-center justify-between"><h1 className="text-2xl font-bold">Receivables &amp; payables ageing</h1><Link href="/finance/invoices" className="btn-ghost">Invoices</Link></header>
        <Table title="Owed to us" a={rec} who="Client" /><Table title="We owe" a={pay} who="Vendor" />
      </div>
    );
  });
}
