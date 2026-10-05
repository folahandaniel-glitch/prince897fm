import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page, mutate, field } from '@/server/session';
import { compensationFor, setCompensation } from '@/server/payroll';
import { need } from '@/server/ctx';
import { toDb } from '@/domain/finance';
import { ActionForm, Field } from '@/components/forms';
import { PageHead } from '@/components/ui';

export const dynamic = 'force-dynamic';

async function save(_p: unknown, f: FormData) {
  'use server';
  const id = field(f, 'id');
  return mutate([`/payroll/people/${id}`, '/payroll/people'], async (c) => {
    await setCompensation(c, id, {
      basic: field(f, 'basic'), housing: field(f, 'housing'), transport: field(f, 'transport'),
      others: [1, 2, 3].map((n) => ({ name: field(f, `on${n}`), amount: field(f, `oa${n}`) })), pension: field(f, 'pension') === 'on', nhf: field(f, 'nhf') === 'on', annualRent: field(f, 'rent'),
      taxId: field(f, 'taxId'), pensionPin: field(f, 'pin'), bankName: field(f, 'bank'), bankAccount: field(f, 'account'), effectiveFrom: field(f, 'from'),
    });
    return 'Saved. The previous amounts remain in the history.';
  });
}
const naira = (minor: number) => (minor / 100).toFixed(2);

export default async function EditComp({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return page(async (p) => {
    p.requireFeature('payroll');
    need(p.ctx, 'payroll:manage');
    const e = (await p.ctx.q.query<any>('select id, full_name from employees where id = $1', [id]))[0];
    if (!e) notFound();
    const { cur, hist } = await compensationFor(p.ctx, id);
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHead title={e.full_name} sub="Monthly pay, in naira."><Link href="/payroll/people" className="btn-ghost">← Salaries</Link></PageHead>
        <div className="card"><ActionForm action={save as any} submit="Save salary">
          <input type="hidden" name="id" value={id} />
          <div className="grid gap-x-4 sm:grid-cols-3"><Field label="Basic salary" name="basic" required defaultValue={cur ? naira(cur.basic) : ''} /><Field label="Housing allowance" name="housing" defaultValue={cur ? naira(cur.housing) : ''} /><Field label="Transport allowance" name="transport" defaultValue={cur ? naira(cur.transport) : ''} /></div>
          <div className="grid gap-x-4 sm:grid-cols-3">{[1, 2, 3].map((n) => <div key={n}><Field label={`Other allowance ${n}`} name={`on${n}`} defaultValue={cur?.others[n - 1]?.name} placeholder="e.g. Presenter allowance" /><Field label="Amount" name={`oa${n}`} defaultValue={cur?.others[n - 1] ? naira(cur.others[n - 1].amount) : ''} /></div>)}</div>
          <div className="grid gap-x-4 sm:grid-cols-2"><label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" name="pension" defaultChecked={cur?.pensionEnabled ?? true} className="h-5 w-5" /> Pension contribution applies</label><label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" name="nhf" defaultChecked={cur?.nhfEnabled ?? false} className="h-5 w-5" /> National Housing Fund applies</label></div>
          <div className="grid gap-x-4 sm:grid-cols-2"><Field label="Annual rent paid (for rent relief)" name="rent" defaultValue={cur ? naira(cur.annualRent) : ''} /><Field label="Tax ID" name="taxId" defaultValue={cur?.taxId ?? ''} /><Field label="Pension PIN" name="pin" defaultValue={cur?.pensionPin ?? ''} /><Field label="Bank" name="bank" defaultValue={cur?.bankName ?? ''} /><Field label="Account number" name="account" defaultValue={cur?.bankAccount ?? ''} /><Field label="Takes effect from" name="from" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></div>
        </ActionForm></div>
        <section className="card"><h2 className="font-semibold">History</h2>{hist.length === 0 ? <p className="mt-2 text-sm text-muted">No salary on record yet.</p> : <ul className="mt-2 divide-y divide-line text-sm">{hist.map((h: any, i: number) => <li key={i} className="flex justify-between py-2"><span>{h.ef} → {h.et ?? 'present'}</span><span className="tabular-nums">Basic {Number(h.basic).toLocaleString(p.org.locale, { minimumFractionDigits: 2 })}</span></li>)}</ul>}</section>
        <p className="hidden">{toDb(0)}</p>
      </div>
    );
  });
}
