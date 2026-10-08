import { page, mutate, field } from '@/server/session';
import { advanceLimit, cancelAdvance, decideAdvance, listAdvances, payAdvance, requestAdvance } from '@/server/advances';
import { listAccounts } from '@/server/finance';
import { formatMoney } from '@/domain/finance';
import { ActionForm, Field, Select } from '@/components/forms';
import { PageHead, Empty, Notice } from '@/components/ui';

export const metadata = { title: 'Salary advances' };
export const dynamic = 'force-dynamic';

async function request(_p: unknown, f: FormData) { 'use server'; return mutate(['/advances'], async (c) => { await requestAdvance(c, { amount: field(f, 'amount'), months: Number(field(f, 'months')), reason: field(f, 'reason') }); return 'Request sent for approval.'; }); }
async function decide(_p: unknown, f: FormData) { 'use server'; return mutate(['/advances'], async (c) => { const ok = field(f, 'intent') === 'approve'; await decideAdvance(c, field(f, 'id'), ok, field(f, 'note')); return ok ? 'Approved.' : 'Declined.'; }); }
async function pay(_p: unknown, f: FormData) { 'use server'; return mutate(['/advances'], async (c) => { await payAdvance(c, field(f, 'id'), { cashAccountId: field(f, 'cash'), reference: field(f, 'reference') }); return 'Paid. Recoveries are scheduled in payroll.'; }); }
async function cancel(_p: unknown, f: FormData) { 'use server'; return mutate(['/advances'], async (c) => { await cancelAdvance(c, field(f, 'id')); return 'Cancelled.'; }); }

const TONE: Record<string, string> = { requested: 'bg-amber-100 text-amber-900', approved: 'bg-sky-100 text-sky-900', paid: 'bg-indigo-100 text-indigo-900', settled: 'bg-emerald-100 text-emerald-900', rejected: 'bg-red-100 text-red-900', cancelled: '' };

export default async function Advances() {
  return page(async (p) => {
    p.requireFeature('payroll');
    const cur = p.org.currency, loc = p.org.locale;
    const fm = (n: number) => formatMoney(n, cur, loc);
    const mine = p.allowed('advance:request') ? await listAdvances(p.ctx, 'mine') : [];
    const handler = p.allowed('advance:approve') || p.allowed('advance:pay');
    const all = handler ? await listAdvances(p.ctx, 'all') : [];
    const limit = p.ctx.subject.employeeId && p.allowed('advance:request') ? await advanceLimit(p.ctx, p.ctx.subject.employeeId) : null;
    const cash = p.allowed('advance:pay') ? (await listAccounts(p.ctx.q)).filter((a: any) => a.is_cash && a.active) : [];
    const open = mine.some((a: any) => ['requested', 'approved', 'paid'].includes(a.status));
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <PageHead title="Salary advances" sub="Borrow up to one month's pay and repay it through payroll over 1 to 6 months." />
        {p.allowed('advance:request') && <>
          {!open && limit != null && <section className="card"><h2 className="font-semibold">Request an advance</h2><p className="text-sm text-muted">You can ask for up to {fm(limit)}.</p>
            <ActionForm action={request as any} submit="Send request" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-2"><Field label="Amount" name="amount" required placeholder="50000" /><Select label="Repay over" name="months" allowEmpty={false} defaultValue="3" options={[1, 2, 3, 4, 5, 6].map((x) => ({ value: String(x), label: `${x} month${x > 1 ? 's' : ''}` }))} /></div><Field label="Reason" name="reason" required /></ActionForm></section>}
          {limit == null && <Notice>No salary is on file for you yet, so advances are not available. Ask HR.</Notice>}
          <section className="card"><h2 className="font-semibold">My requests</h2>
            {mine.length === 0 ? <p className="mt-2 text-sm text-muted">None.</p> : <ul className="mt-2 divide-y divide-line text-sm">{mine.map((a: any) => (
              <li key={a.id} className="py-2"><div className="flex flex-wrap items-center justify-between gap-2"><span>{fm(a.amountMinor)} over {a.months} month(s)</span><span className={`badge ${TONE[a.status] ?? ''}`}>{a.status}</span></div>
                {a.status === 'paid' && <p className="text-xs text-muted">Repaid {fm(a.repaidMinor)} ({a.repaid_n}/{a.months})</p>}{a.decision_note && <p className="text-xs text-muted">{a.decision_note}</p>}
                {['requested', 'approved'].includes(a.status) && <ActionForm action={cancel as any} submit="Cancel request" tone="ghost" className="[&>div]:!mt-1"><input type="hidden" name="id" value={a.id} /></ActionForm>}</li>))}</ul>}</section></>}
        {handler && <section className="card"><h2 className="font-semibold">All requests</h2>
          {all.length === 0 ? <p className="mt-2 text-sm text-muted">None.</p> : <ul className="mt-2 divide-y divide-line text-sm">{all.map((a: any) => (
            <li key={a.id} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span><b>{a.full_name}</b> · {fm(a.amountMinor)} over {a.months}m<span className="block text-xs text-muted">{a.reason}</span></span><span className={`badge ${TONE[a.status] ?? ''}`}>{a.status}</span></div>
              {a.status === 'requested' && p.allowed('advance:approve') && a.user_id !== p.ctx.userId && <ActionForm action={decide as any} submit="Approve" className="mt-2" buttons={[{ label: 'Approve', value: 'approve' }, { label: 'Decline', value: 'decline', tone: 'ghost' }]}><input type="hidden" name="id" value={a.id} /><input name="note" className="input" placeholder="Note (required when declining)" aria-label="Note" /></ActionForm>}
              {a.status === 'approved' && p.allowed('advance:pay') && a.user_id !== p.ctx.userId && <ActionForm action={pay as any} submit="Record payment" className="mt-2"><input type="hidden" name="id" value={a.id} /><div className="grid gap-x-4 sm:grid-cols-2"><Select label="Paid from" name="cash" required allowEmpty={false} options={cash.map((x: any) => ({ value: x.id, label: x.name }))} /><Field label="Payment reference" name="reference" required /></div></ActionForm>}</li>))}</ul>}</section>}
        {!p.allowed('advance:request') && !handler && <Empty title="Not available for your role" />}
      </div>
    );
  });
}
