import Link from 'next/link';
import { page, mutate, field } from '@/server/session';
import { createRun, getSettings, listRuns } from '@/server/payroll';
import { need } from '@/server/ctx';
import { Money } from '@/components/money';
import { ActionForm, Field } from '@/components/forms';
import { Empty, Notice, PageHead } from '@/components/ui';

export const metadata = { title: 'Payroll' };
export const dynamic = 'force-dynamic';

async function prepare(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/payroll'], async (c) => {
    const r = await createRun(c, field(f, 'period'));
    return `Prepared ${r.employees} payslips.${r.missing.length ? ` No salary on record for: ${r.missing.join(', ')}.` : ''} Another person must approve it before staff can see their payslips.`;
  });
}

const TONE: Record<string, string> = { draft: 'bg-amber-100 text-amber-900', approved: 'bg-sky-100 text-sky-900', paid: 'bg-emerald-100 text-emerald-900', cancelled: '' };

export default async function PayrollHome() {
  return page(async (p) => {
    p.requireFeature('payroll');
    need(p.ctx, 'payroll:view');
    const [runs, st] = await Promise.all([listRuns(p.ctx), getSettings(p.ctx.q)]);
    const k = { cur: p.org.currency, loc: p.org.locale };
    const lastMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    return (
      <div className="space-y-5">
        <PageHead title="Payroll" sub="Prepare, approve and pay salaries. Every payslip is itemised and frozen once published.">
          {p.allowed('payroll:manage') && <><Link href="/payroll/fines" className="btn-ghost">Fines &amp; adjustments</Link><Link href="/payroll/people" className="btn-ghost">Salaries</Link></>}
          {p.allowed('payroll:configure') && <Link href="/payroll/settings" className="btn-ghost">Settings</Link>}
        </PageHead>
        {(!st.saved || !st.verifiedBy || /NOT verified/i.test(st.verifiedBy)) && <Notice tone="warn">Tax bands and statutory rates have not been confirmed by an accountant. Review them under Payroll settings before approving real payroll.</Notice>}
        {p.allowed('payroll:manage') && (
          <section className="card" aria-labelledby="new"><h2 id="new" className="font-semibold">Prepare a payroll run</h2>
            <ActionForm action={prepare as any} submit="Prepare payslips" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-3"><Field label="Month" name="period" type="month" required defaultValue={lastMonth} /></div>
              <p className="text-xs text-muted">Uses each person&apos;s salary on record, statutory deductions, and approved fines and adjustments for the month.</p></ActionForm></section>)}
        {runs.length === 0 ? <Empty title="No payroll runs yet" text="Prepare the first run once salaries are entered." /> : (
          <div className="card overflow-x-auto p-0"><table className="w-full min-w-[34rem]"><thead><tr className="border-b border-line"><th className="th">Month</th><th className="th">Status</th><th className="th text-right">Staff</th><th className="th text-right">Gross</th><th className="th text-right">Net</th><th className="th" /></tr></thead>
            <tbody>{runs.map((r: any) => (
              <tr key={r.id} className="border-b border-line last:border-0"><td className="td font-medium">{r.period}</td><td className="td"><span className={`badge ${TONE[r.status] ?? ''}`}>{r.status}</span></td>
                <td className="td text-right">{r.totals.employees ?? 0}</td><td className="td text-right"><Money v={r.totals.gross ?? 0} {...k} /></td><td className="td text-right"><Money v={r.totals.net ?? 0} {...k} /></td>
                <td className="td text-right"><Link className="underline" href={`/payroll/runs/${r.id}`}>Open</Link></td></tr>))}</tbody></table></div>)}
      </div>
    );
  });
}
