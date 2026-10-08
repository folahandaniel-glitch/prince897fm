import Link from 'next/link';
import { page } from '@/server/session';
import { listPayments } from '@/server/reporthub';
import { formatMoney } from '@/domain/finance';
import { PageHead, Empty } from '@/components/ui';

export const metadata = { title: 'Payments' };
export const dynamic = 'force-dynamic';

export default async function Payments() {
  return page(async (p) => {
    p.requireFeature('finance');
    const rows = await listPayments(p.ctx);
    const m = (n: number) => formatMoney(n, p.org.currency, p.org.locale);
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <PageHead title="Payments" sub="Money received from clients and paid to suppliers against invoices." />
        {rows.length === 0 ? <Empty title="No payments recorded yet" /> : <div className="card overflow-x-auto !p-0"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-muted"><tr><th className="p-3">Date</th><th>Invoice</th><th>Party</th><th>Direction</th><th className="text-right">Cash</th><th className="text-right">WHT</th><th className="pr-3">Reference</th></tr></thead>
          <tbody className="divide-y divide-line">{rows.map((r: any) => <tr key={r.id}><td className="p-3">{r.paid_on}</td><td><Link className="underline" href={`/finance/invoices/${r.invoice_id}`}>{r.number}</Link></td><td>{r.party}</td><td>{r.kind === 'receivable' ? 'Received' : 'Paid out'}</td><td className="text-right tabular-nums">{m(r.cashMinor)}</td><td className="text-right tabular-nums">{r.whtMinor ? m(r.whtMinor) : '—'}</td><td className="pr-3">{r.reference}</td></tr>)}</tbody></table></div>}
      </div>
    );
  });
}
