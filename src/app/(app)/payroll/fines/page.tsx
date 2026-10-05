import Link from 'next/link';
import { page, mutate, field } from '@/server/session';
import { addManualAdjustment, decideAdjustment, getPolicies, listAdjustments, proposeFines } from '@/server/payroll';
import { need } from '@/server/ctx';
import { formatMoney, fromDb } from '@/domain/finance';
import { ActionForm, Field, Select } from '@/components/forms';
import { Empty, Notice, PageHead } from '@/components/ui';

export const metadata = { title: 'Fines & adjustments' };
export const dynamic = 'force-dynamic';

async function propose(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/payroll/fines'], async (c) => { const r = await proposeFines(c, field(f, 'period')); return `Proposed ${r.lateness} lateness and ${r.absence} absence deduction(s). Review each one below. Nothing is deducted until you approve it.`; });
}
async function decide(_p: unknown, f: FormData) {
  'use server';
  const approve = field(f, 'intent') === 'approve';
  return mutate(['/payroll/fines'], async (c) => { await decideAdjustment(c, field(f, 'id'), approve, field(f, 'note')); return approve ? 'Approved for payroll.' : 'Waived. The employee will not be charged.'; });
}
async function manual(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/payroll/fines'], async (c) => { await addManualAdjustment(c, { employeeId: field(f, 'employeeId'), period: field(f, 'period'), kind: field(f, 'kind'), amount: field(f, 'amount'), reason: field(f, 'reason') }); return 'Added. A second person must approve a manual deduction.'; });
}

export default async function Fines({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const sp = await searchParams;
  return page(async (p) => {
    p.requireFeature('payroll');
    need(p.ctx, 'payroll:manage');
    const period = sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    const [list, pol, people] = await Promise.all([listAdjustments(p.ctx, period), getPolicies(p.ctx.q), p.ctx.q.query<any>(`select id, full_name from employees where status in ('active','on_leave') and not hidden order by full_name`)]);
    const k = (v: unknown) => formatMoney(fromDb(v as string), p.org.currency, p.org.locale);
    return (
      <div className="space-y-5">
        <PageHead title="Fines & adjustments" sub="Lateness and absence fines are proposed from attendance. HR approves or waives each one before it reaches a payslip."><Link href="/payroll" className="btn-ghost">← Payroll</Link></PageHead>
        {!pol.lateness.active && !pol.absence.active && <Notice tone="warn">No fine policy is switched on. Fines only apply once a policy has a recorded legal basis (contract or handbook clause) under Payroll settings.</Notice>}
        <form className="flex flex-wrap items-end gap-2"><div><label className="label" htmlFor="period">Month</label><input id="period" name="period" type="month" defaultValue={period} className="input" /></div><button className="btn-ghost">Show</button></form>
        <section className="card"><h2 className="font-semibold">Propose fines from attendance for {period}</h2>
          <ActionForm action={propose as any} submit="Scan attendance" className="mt-2"><input type="hidden" name="period" value={period} /></ActionForm>
          <p className="text-xs text-muted">Days with an approved explanation, approved leave, or a reviewed exception are never fined. The first {pol.lateness.freePerMonth} late arrivals each month are forgiven under the current policy.</p></section>
        {list.length === 0 ? <Empty title="Nothing for this month" text="Scan attendance, or add a manual adjustment below." /> : (
          <ul className="space-y-3">{list.map((a: any) => (
            <li key={a.id} className="card"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium">{a.full_name} <span className="badge ml-1">{a.kind}</span> <span className="badge">{a.source_type}</span></p><p className="text-sm text-muted">{a.reason}</p></div><div className="text-right"><p className="text-lg font-bold">{k(a.amount)}</p><span className="badge">{a.status}</span></div></div>
              {Array.isArray(a.detail) && a.detail.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-muted">{a.detail.map((d: any, i: number) => <li key={i} className="flex justify-between"><span>{d.label}</span><span>{k(d.amount)}</span></li>)}</ul>}
              {a.status === 'proposed' && <ActionForm action={decide as any} submit="Approve" className="mt-3" buttons={[{ label: 'Approve', value: 'approve' }, { label: 'Waive', value: 'waive', tone: 'ghost' }]}><input type="hidden" name="id" value={a.id} /><Field label="Note (required to waive)" name="note" /></ActionForm>}
              {a.decision_note && <p className="mt-2 text-xs text-muted">Decision: {a.decision_note}</p>}</li>))}</ul>)}
        <section className="card" aria-labelledby="man"><h2 id="man" className="font-semibold">Add a manual adjustment</h2>
          <ActionForm action={manual as any} submit="Add" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-4"><Select label="Employee" name="employeeId" required allowEmpty={false} options={people.map((x: any) => ({ value: x.id, label: x.full_name }))} /><Field label="Month" name="period" type="month" required defaultValue={period} />
            <Select label="Type" name="kind" allowEmpty={false} defaultValue="bonus" options={[{ value: 'bonus', label: 'Bonus' }, { value: 'allowance', label: 'Allowance' }, { value: 'overtime', label: 'Overtime' }, { value: 'deduction', label: 'Deduction' }, { value: 'loan_repayment', label: 'Loan repayment' }, { value: 'fine', label: 'Fine' }]} /><Field label="Amount (₦)" name="amount" required /></div><Field label="Reason (shown on the payslip)" name="reason" required /></ActionForm></section>
      </div>
    );
  });
}
