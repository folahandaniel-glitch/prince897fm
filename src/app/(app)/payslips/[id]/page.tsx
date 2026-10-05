import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page } from '@/server/session';
import { getPayslip } from '@/server/payroll';
import { Money } from '@/components/money';
import { PrintButton } from '@/components/print-button';

export const dynamic = 'force-dynamic';

export default async function PayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return page(async (p) => {
    p.requireFeature('payroll');
    const s = await getPayslip(p.ctx, id);
    if (!s) notFound();
    const k = { cur: s.org.currency, loc: s.org.locale };
    const d = s.details;
    const month = new Date(`${s.period}-01T00:00:00Z`).toLocaleDateString(s.org.locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="no-print flex flex-wrap items-center justify-between gap-2"><Link href={s.mine ? '/payslips' : '/payroll'} className="text-sm underline">← Back</Link>
          <div className="flex gap-2"><PrintButton label="Print" /><a className="btn-primary" href={`/api/payslip/${id}/pdf`}>Download PDF</a></div></div>
        <article className="card !p-0 overflow-hidden" aria-label={`Payslip for ${month}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 bg-[#111] px-5 py-4 text-white"><div><p className="text-lg font-bold">{s.org.name}</p><p className="text-xs uppercase tracking-widest text-[#FFC700]">Payslip</p></div><p className="text-lg font-semibold">{month}</p></div>
          <div className="space-y-6 p-5">
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div><dt className="text-xs uppercase text-muted">Employee</dt><dd className="font-semibold">{s.employee.name}</dd></div><div><dt className="text-xs uppercase text-muted">Employee no.</dt><dd className="font-semibold">{s.employee.number}</dd></div><div><dt className="text-xs uppercase text-muted">Department</dt><dd className="font-semibold">{s.employee.department ?? '-'}</dd></div>
              <div><dt className="text-xs uppercase text-muted">Position</dt><dd className="font-semibold">{s.employee.position ?? '-'}</dd></div><div><dt className="text-xs uppercase text-muted">Bank</dt><dd className="font-semibold">{s.employee.bankName ?? '-'}{s.employee.bankAccount ? ` ····${String(s.employee.bankAccount).slice(-4)}` : ''}</dd></div><div><dt className="text-xs uppercase text-muted">Tax ID</dt><dd className="font-semibold">{s.employee.taxId ?? '-'}</dd></div>
            </dl>

            <section aria-labelledby="e"><h2 id="e" className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Earnings</h2>
              <ul className="divide-y divide-line text-sm">{d.earnings.map((r, i) => <li key={i} className="flex justify-between py-2"><span>{r.label}</span><Money v={r.amount} {...k} /></li>)}
                <li className="flex justify-between py-2 font-bold"><span>Gross pay</span><Money v={s.gross} {...k} /></li></ul></section>

            <section aria-labelledby="d"><h2 id="d" className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Deductions</h2>
              {d.deductions.length === 0 ? <p className="text-sm text-muted">No deductions this month.</p> : (
                <ul className="divide-y divide-line text-sm">{d.deductions.map((r, i) => (
                  <li key={i} className="py-2"><div className="flex justify-between"><span className={r.kind === 'fine' ? 'font-semibold text-red-700 dark:text-red-400' : ''}>{r.label}</span><Money v={r.amount} {...k} /></div>
                    {r.detail && <ul className="mt-1 space-y-0.5 pl-4 text-xs text-muted">{r.detail.map((x, j) => <li key={j} className="flex justify-between"><span>{x.label}</span><Money v={x.amount} {...k} /></li>)}</ul>}</li>))}
                  <li className="flex justify-between py-2 font-bold"><span>Total deductions</span><Money v={s.totalDeductions} {...k} /></li></ul>)}
              {d.deductions.some((x) => x.kind === 'fine') && <p className="mt-2 rounded-lg bg-surface p-3 text-xs text-muted">Fines are listed with the dates they relate to. If you disagree with any deduction, you can query it in writing with HR. See <Link className="underline" href="/discipline">Warnings &amp; queries</Link>.</p>}</section>

            <div className="flex items-center justify-between rounded-xl border-2 border-[#FFC700] bg-[#FFC700]/10 px-4 py-3"><span className="text-lg font-bold">Net pay</span><span className="text-2xl font-bold"><Money v={s.net} {...k} /></span></div>

            {d.employer.length > 0 && <section><h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Employer contributions (not deducted from your pay)</h2>
              <ul className="text-xs text-muted">{d.employer.map((r, i) => <li key={i} className="flex justify-between"><span>{r.label}</span><Money v={r.amount} {...k} /></li>)}</ul></section>}
            <p className="text-xs text-muted">Income tax is calculated on annualised taxable pay of <Money v={d.tax.taxable} {...k} />. This payslip is computer generated.</p>
          </div>
        </article>
      </div>
    );
  });
}
