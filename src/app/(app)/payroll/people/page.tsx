import Link from 'next/link';
import { page } from '@/server/session';
import { compensationOverview } from '@/server/payroll';
import { Money } from '@/components/money';
import { PageHead } from '@/components/ui';

export const metadata = { title: 'Salaries' };
export const dynamic = 'force-dynamic';

export default async function People() {
  return page(async (p) => {
    p.requireFeature('payroll');
    const rows = await compensationOverview(p.ctx);
    const k = { cur: p.org.currency, loc: p.org.locale };
    return (
      <div className="space-y-4">
        <PageHead title="Salaries" sub="Monthly pay on record for each person. Changes are dated and never overwrite history."><Link href="/payroll" className="btn-ghost">← Payroll</Link></PageHead>
        <div className="card overflow-x-auto p-0"><table className="w-full min-w-[36rem]"><thead><tr className="border-b border-line"><th className="th">Name</th><th className="th">Department</th><th className="th text-right">Monthly gross</th><th className="th">Since</th><th className="th" /></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className="border-b border-line last:border-0"><td className="td font-medium">{r.name}</td><td className="td">{r.department ?? '-'}</td><td className="td text-right">{r.has ? <Money v={r.gross} {...k} /> : <span className="badge bg-amber-100 text-amber-900">not set</span>}</td><td className="td">{r.since ?? '-'}</td>
            <td className="td text-right">{p.allowed('payroll:manage') && <Link className="underline" href={`/payroll/people/${r.id}`}>{r.has ? 'Change' : 'Set salary'}</Link>}</td></tr>)}</tbody></table></div>
      </div>
    );
  });
}
