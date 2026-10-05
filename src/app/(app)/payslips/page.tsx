import Link from 'next/link';
import { page } from '@/server/session';
import { myPayslips } from '@/server/payroll';
import { Money } from '@/components/money';
import { Empty, PageHead } from '@/components/ui';

export const metadata = { title: 'My payslips' };
export const dynamic = 'force-dynamic';

const monthName = (p: string, loc: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString(loc, { month: 'long', year: 'numeric', timeZone: 'UTC' });

export default async function Payslips() {
  return page(async (p) => {
    p.requireFeature('payroll');
    const list = await myPayslips(p.ctx);
    const k = { cur: p.org.currency, loc: p.org.locale };
    return (
      <div className="mx-auto max-w-3xl">
        <PageHead title="My payslips" sub="Your pay, calculated and itemised. Each payslip can be printed or saved as a PDF." />
        {list.length === 0 ? <Empty title="No payslips yet" text="Your payslip appears here once payroll for a month has been approved." /> : (
          <ul className="space-y-3">{list.map((s) => (
            <li key={s.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div><p className="text-lg font-semibold">{monthName(s.period, p.org.locale)}</p>
                <p className="text-sm text-muted">Gross <Money v={s.gross} {...k} /> · Deductions <Money v={s.deductions} {...k} /></p></div>
              <div className="flex items-center gap-3"><p className="text-xl font-bold"><Money v={s.net} {...k} /></p>
                <Link href={`/payslips/${s.id}`} className="btn-primary">View</Link>
                <a href={`/api/payslip/${s.id}/pdf`} className="btn-ghost">PDF</a></div>
            </li>))}</ul>)}
      </div>
    );
  });
}
