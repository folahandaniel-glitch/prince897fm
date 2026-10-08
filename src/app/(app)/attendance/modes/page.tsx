import { page, mutate, field } from '@/server/session';
import { listModes, MODES, setMode, WEEKDAYS } from '@/server/modes';
import { need } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';
import { Notice } from '@/components/ui';

export const metadata = { title: 'Where staff may clock in' };
export const dynamic = 'force-dynamic';

async function save(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/attendance/modes', '/attendance'], async (c) => {
    await setMode(c, field(f, 'id'), { mode: field(f, 'mode'), remoteWeekdays: f.getAll('days').map(Number), validFrom: field(f, 'from') || undefined, validTo: field(f, 'to') || undefined, reason: field(f, 'reason') });
    return 'Saved. It applies from the next clock-in.';
  });
}

export default async function Modes() {
  return page(async (p) => {
    p.requireFeature('attendance');
    need(p.ctx, 'attendance:manage');
    const rows = await listModes(p.ctx);
    const label = (k: string | null) => MODES.find((m) => m.key === (k ?? 'on_site'))!.label;
    return (
      <div className="min-w-0 space-y-5">
        <header><h1 className="text-2xl font-bold">Where staff may clock in</h1><p className="text-sm text-muted">By default everyone must be inside an assigned workplace. Give an exception to people whose work is not tied to one building.</p></header>
        <Notice>Exceptions never switch attendance off: the location is still recorded when the phone shares it, the entry is flagged for the supervisor, and every change is in the audit trail.</Notice>
        <section className="card"><h2 className="font-semibold">The arrangements</h2><dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">{MODES.map((m) => <div key={m.key}><dt className="font-medium">{m.label}</dt><dd className="text-muted">{m.help}</dd></div>)}</dl></section>
        <ul className="space-y-3">{rows.map((r: any) => (
          <li key={r.id} className="card"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="font-semibold">{r.full_name} <span className="text-sm font-normal text-muted">{r.employee_no}{r.department ? ` · ${r.department}` : ''}</span></p>
            <p className="text-sm"><span className={`badge ${r.mode ? 'bg-amber-100 text-amber-900' : ''}`}>{label(r.mode)}</span>{r.mode === 'hybrid' && <span className="ml-2 text-muted">remote on {(r.remote_weekdays as number[]).map((d) => WEEKDAYS[d].slice(0, 3)).join(', ')}</span>}{r.valid_to && <span className="ml-2 text-muted">{r.valid_from ?? ''} to {r.valid_to}</span>}</p>{r.reason && <p className="text-xs text-muted">{r.reason}</p>}</div></div>
            <details className="mt-2"><summary className="cursor-pointer text-sm font-medium underline">Change</summary>
              <ActionForm action={save as any} submit="Save" className="mt-3"><input type="hidden" name="id" value={r.id} />
                <div className="grid gap-x-4 sm:grid-cols-2"><Select label="Arrangement" name="mode" allowEmpty={false} defaultValue={r.mode ?? 'on_site'} options={MODES.map((m) => ({ value: m.key, label: m.label }))} /><Field label="Reason (needed for any exception)" name="reason" defaultValue={r.reason ?? ''} /></div>
                <fieldset className="mb-3"><legend className="label">Hybrid: days away from the office</legend><div className="flex flex-wrap gap-3 text-sm">{WEEKDAYS.map((d, i) => <label key={d} className="flex items-center gap-1.5"><input type="checkbox" name="days" value={i} defaultChecked={(r.remote_weekdays ?? []).includes(i)} className="h-5 w-5" />{d.slice(0, 3)}</label>)}</div></fieldset>
                <div className="grid gap-x-4 sm:grid-cols-2"><Field label="From (temporary exceptions)" name="from" type="date" defaultValue={r.valid_from ?? ''} /><Field label="Until" name="to" type="date" defaultValue={r.valid_to ?? ''} /></div></ActionForm></details></li>))}</ul>
      </div>
    );
  });
}
