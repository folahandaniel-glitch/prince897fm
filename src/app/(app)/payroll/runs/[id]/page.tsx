import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page, mutate, field } from '@/server/session';
import { approveRun, cancelRun, getRun, payRun } from '@/server/payroll';
import { listAccounts } from '@/server/finance';
import { Money } from '@/components/money';
import { ActionForm, Field, Select } from '@/components/forms';
import { Notice, PageHead, Stat } from '@/components/ui';

export const dynamic = 'force-dynamic';

const paths = (id: string) => [`/payroll/runs/${id}`, '/payroll'];
async function approve(_p: unknown, f: FormData) { 'use server'; const id = field(f, 'id'); return mutate(paths(id), async (c) => { await approveRun(c, id); return 'Approved. Payslips are now visible to staff and the ledger has been updated.'; }); }
async function cancel(_p: unknown, f: FormData) { 'use server'; const id = field(f, 'id'); return mutate(paths(id), async (c) => { await cancelRun(c, id, field(f, 'reason')); return 'Draft cancelled. You can prepare it again.'; }); }
async function pay(_p: unknown, f: FormData) { 'use server'; const id = field(f, 'id'); return mutate(paths(id), async (c) => { await payRun(c, id, { cashAccountId: field(f, 'cashAccountId'), reference: field(f, 'reference') }); return 'Salary payment recorded.'; }); }

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return page(async (p) => {
    p.requireFeature('payroll');
    const d = await getRun(p.ctx, id);
    if (!d) notFound();
    const { run, slips } = d;
    const t = run.totals as Record<string, any>;
    const k = { cur: p.org.currency, loc: p.org.locale };
    const accts = run.status === 'approved' && p.allowed('payroll:pay') ? (await listAccounts(p.ctx.q)).filter((a: any) => a.is_cash && a.active) : [];
    const me = p.ctx.userId;
    return (
      <div className="space-y-5">
        <nav className="text-sm text-muted" aria-label="Breadcrumb"><Link className="underline" href="/payroll">Payroll</Link> / {run.period}</nav>
        <PageHead title={`Payroll ${run.period}`} sub={`Prepared by ${run.prepared_email}${run.approved_email ? ` · approved by ${run.approved_email}` : ''}${run.paid_email ? ` · paid by ${run.paid_email}` : ''}`}><span className="badge text-sm">{run.status}</span></PageHead>
        {t.missingCompensation?.length > 0 && <Notice tone="warn">No salary on record for: {t.missingCompensation.join(', ')}. They are not included.</Notice>}
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Staff paid" value={t.employees ?? 0} /><Stat label="Gross pay" value={<Money v={t.gross ?? 0} {...k} />} /><Stat label="Net pay" value={<Money v={t.net ?? 0} {...k} />} /><Stat label="Fines deducted" value={<Money v={t.fines ?? 0} {...k} />} sub={`PAYE ${(t.paye ?? 0) / 100}`} /></section>
        <section className="card overflow-x-auto p-0"><table className="w-full min-w-[36rem]"><thead><tr className="border-b border-line"><th className="th">Staff</th><th className="th text-right">Gross</th><th className="th text-right">Deductions</th><th className="th text-right">Net</th><th className="th" /></tr></thead>
          <tbody>{slips.map((s: any) => <tr key={s.id} className="border-b border-line last:border-0"><td className="td font-medium">{s.employee_snapshot.name}</td><td className="td text-right"><Money v={Number(s.gross) * 100} {...k} /></td><td className="td text-right"><Money v={Number(s.total_deductions) * 100} {...k} /></td><td className="td text-right"><Money v={Number(s.net) * 100} {...k} /></td><td className="td text-right"><Link className="underline" href={`/payslips/${s.id}`}>Payslip</Link></td></tr>)}</tbody></table></section>

        {run.status === 'draft' && p.allowed('payroll:approve') && run.prepared_by !== me && <section className="card"><h2 className="font-semibold">Approve this payroll</h2><p className="text-sm text-muted">Approving publishes every payslip to staff and posts the cost, taxes and deductions to the ledger. Check the totals above first.</p><ActionForm action={approve as any} submit="Approve payroll" className="mt-3"><input type="hidden" name="id" value={id} /></ActionForm></section>}
        {run.status === 'draft' && run.prepared_by === me && <Notice>You prepared this payroll. Someone with approval authority (Finance Manager, CEO or Chairman) must approve it.</Notice>}
        {run.status === 'draft' && p.allowed('payroll:manage') && <section className="card"><h2 className="font-semibold">Cancel this draft</h2><ActionForm action={cancel as any} submit="Cancel draft" tone="danger" className="mt-3" confirm="Cancel this draft run?"><input type="hidden" name="id" value={id} /><Field label="Reason" name="reason" required /></ActionForm></section>}
        {run.status === 'approved' && accts.length > 0 && ![run.prepared_by, run.approved_by].includes(me) && <section className="card"><h2 className="font-semibold">Record salary payment</h2><p className="text-sm text-muted">Records that net salaries of <Money v={t.net ?? 0} {...k} /> were paid. It does not move money from a bank.</p><ActionForm action={pay as any} submit="Record payment" className="mt-3"><input type="hidden" name="id" value={id} /><Select label="Pay from" name="cashAccountId" required allowEmpty={false} options={accts.map((a: any) => ({ value: a.id, label: a.name }))} /><Field label="Bank batch / reference" name="reference" required /></ActionForm></section>}
      </div>
    );
  });
}
