import Link from 'next/link';
import { page, mutate, field } from '@/server/session';
import { getPolicies, getSettings, savePolicy, saveSettings } from '@/server/payroll';
import { need } from '@/server/ctx';
import { ActionForm, Field } from '@/components/forms';
import { Notice, PageHead } from '@/components/ui';

export const metadata = { title: 'Payroll settings' };
export const dynamic = 'force-dynamic';

async function settings(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/payroll/settings', '/payroll'], async (c) => {
    await saveSettings(c, {
      bands: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ upTo: field(f, `u${n}`), rate: field(f, `r${n}`) })),
      pensionEmployeePct: Number(field(f, 'pe')), pensionEmployerPct: Number(field(f, 'pr')), nhfPct: Number(field(f, 'nhf')), nsitfPct: Number(field(f, 'nsitf')),
      rentReliefPct: Number(field(f, 'rrp')), rentReliefCap: field(f, 'rrc') || '0', maxDiscretionaryPct: Number(field(f, 'max')), verifiedBy: field(f, 'verified'), note: field(f, 'note'),
    });
    return 'Settings saved and audited.';
  });
}
async function policy(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/payroll/settings'], async (c) => {
    await savePolicy(c, { kind: field(f, 'kind') as 'lateness' | 'absence', freePerMonth: Number(field(f, 'free') || 0), perIncident: field(f, 'inc'), perMinute: field(f, 'min'), monthlyCap: field(f, 'cap'), dailyRatePct: Number(field(f, 'rate') || 100), legalBasis: field(f, 'basis'), active: field(f, 'active') === 'on' });
    return 'Policy saved.';
  });
}
const naira = (minor: number | null) => (minor === null ? '' : (minor / 100).toString());

export default async function PayrollSettings() {
  return page(async (p) => {
    p.requireFeature('payroll');
    need(p.ctx, 'payroll:configure');
    const [st, pol] = await Promise.all([getSettings(p.ctx.q), getPolicies(p.ctx.q)]);
    const s = st.settings;
    return (
      <div className="space-y-5">
        <PageHead title="Payroll settings" sub="Statutory rates and fine policies are data you control. Confirm them with your accountant and Nigerian law before real payroll."><Link href="/payroll" className="btn-ghost">← Payroll</Link></PageHead>
        <Notice tone="warn">Rates below are starting values only and change with legislation. Record who verified them. {st.verifiedBy ? `Last verified by: ${st.verifiedBy}${st.verifiedOn ? ` on ${st.verifiedOn}` : ''}.` : 'Not yet verified.'}</Notice>
        <section className="card" aria-labelledby="tax"><h2 id="tax" className="font-semibold">Income tax bands (annual taxable income)</h2>
          <ActionForm action={settings as any} submit="Save settings" className="mt-3">
            <p className="mb-2 text-xs text-muted">Each row is the upper limit of a band and its rate. Leave the limit empty on the last row (no ceiling). Enter rates as percentages.</p>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => { const b = s.bands[n - 1]; return <div key={n} className="mb-2 grid gap-2 sm:grid-cols-2"><input name={`u${n}`} aria-label={`Band ${n} upper limit`} className="input" placeholder={n === s.bands.length ? 'No limit (last band)' : 'Upper limit (₦)'} defaultValue={b ? naira(b.upTo) : ''} /><input name={`r${n}`} aria-label={`Band ${n} rate`} className="input" placeholder="Rate %" defaultValue={b ? String(b.rate * 100) : ''} /></div>; })}
            <div className="grid gap-x-4 sm:grid-cols-3"><Field label="Employee pension %" name="pe" defaultValue={String(s.pensionEmployeePct)} /><Field label="Employer pension %" name="pr" defaultValue={String(s.pensionEmployerPct)} /><Field label="NHF % of basic" name="nhf" defaultValue={String(s.nhfPct)} /><Field label="NSITF employer %" name="nsitf" defaultValue={String(s.nsitfPct)} /><Field label="Rent relief %" name="rrp" defaultValue={String(s.rentReliefPct)} /><Field label="Rent relief cap (₦)" name="rrc" defaultValue={String(s.rentReliefCap / 100)} /></div>
            <Field label="Maximum fines/loans/other deductions as % of gross pay" name="max" defaultValue={String(s.maxDiscretionaryPct)} hint="Anything above this is carried to the next month instead of being taken. Set per your contracts and the law." />
            <div className="grid gap-x-4 sm:grid-cols-2"><Field label="Verified by (name and role)" name="verified" defaultValue={st.verifiedBy ?? ''} /><Field label="Note" name="note" defaultValue={st.note ?? ''} /></div>
          </ActionForm></section>
        {(['lateness', 'absence'] as const).map((k) => { const x = pol[k]; return (
          <section key={k} className="card" aria-labelledby={`p-${k}`}><h2 id={`p-${k}`} className="font-semibold capitalize">{k} fines</h2>
            <p className="text-sm text-muted">{k === 'lateness' ? 'Charged per late arrival after the free allowance, from the attendance record.' : 'Charged for rostered days missed without approved leave or a reviewed explanation.'} Off until a legal basis is recorded.</p>
            <ActionForm action={policy as any} submit="Save policy" className="mt-3"><input type="hidden" name="kind" value={k} />
              <div className="grid gap-x-4 sm:grid-cols-3">{k === 'lateness' ? <><Field label="Free late arrivals per month" name="free" type="number" defaultValue={String(x.freePerMonth)} /><Field label="Fine per late arrival (₦)" name="inc" defaultValue={naira(x.perIncident)} /><Field label="Extra per minute late (₦)" name="min" defaultValue={naira(x.perMinute)} /><Field label="Monthly cap (₦, blank = none)" name="cap" defaultValue={naira(x.monthlyCap)} /></> : <Field label="% of one day's pay per absent day" name="rate" type="number" defaultValue={String(x.dailyRatePct)} />}</div>
              <Field label="Legal basis (contract / handbook clause authorising this deduction)" name="basis" defaultValue={x.legalBasis} placeholder="e.g. Employment contract clause 7; Staff handbook 4.2" />
              <label className="mb-1 flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={x.active} className="h-5 w-5" /> Policy is active</label></ActionForm></section>); })}
      </div>
    );
  });
}
