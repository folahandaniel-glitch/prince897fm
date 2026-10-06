import { page, mutate, field } from '@/server/session';
import { addLeaveType, addShift, addWorkplace, assignWorkplace, listLeaveTypes, listShifts, listWorkplaces } from '@/server/attendance';
import { archiveLeaveType, archiveShift, updateLeaveType, updateShift } from '@/server/edits';
import { need } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';
import { UseMyLocation } from '@/components/clock';

export const metadata = { title: 'Shifts & workplaces' };
export const dynamic = 'force-dynamic';

async function shift(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/admin/attendance'], async (c) => { await addShift(c, { name: field(f, 'name'), code: field(f, 'code'), start: field(f, 'start'), end: field(f, 'end'), graceMin: Number(field(f, 'grace')) || 10 }); return 'Shift added.'; });
}
async function workplace(_p: unknown, f: FormData) {
  'use server';
  const n = (k: string) => (field(f, k) === '' ? null : Number(field(f, k)));
  return mutate(['/admin/attendance'], async (c) => {
    await addWorkplace(c, { name: field(f, 'name'), kind: field(f, 'kind'), address: field(f, 'address'), latitude: n('latitude'), longitude: n('longitude'), radiusM: n('radius') ?? 150, validFrom: field(f, 'validFrom'), validTo: field(f, 'validTo') });
    return 'Workplace added.';
  });
}
async function assign(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/admin/attendance'], async (c) => { await assignWorkplace(c, { employeeId: field(f, 'employeeId'), workplaceId: field(f, 'workplaceId'), kind: field(f, 'kind'), validFrom: field(f, 'validFrom'), validTo: field(f, 'validTo') }); return 'Assigned.'; });
}
async function shiftEdit(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/admin/attendance'], async (c) => { await updateShift(c, field(f, 'id'), { name: field(f, 'name'), start: field(f, 'start'), end: field(f, 'end'), graceMin: Number(field(f, 'grace') || 10), earlyMin: Number(field(f, 'early') || 60) }); return 'Shift updated.'; });
}
async function shiftArchive(_p: unknown, f: FormData) { 'use server'; return mutate(['/admin/attendance'], async (c) => { await archiveShift(c, field(f, 'id')); return 'Shift archived.'; }); }
async function leaveEdit(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/admin/attendance', '/leave'], async (c) => { await updateLeaveType(c, field(f, 'id'), { name: field(f, 'name'), annualDays: Number(field(f, 'days')) || 0, paid: field(f, 'paid') === 'on', carryOverMax: Number(field(f, 'carry')) || 0, prorate: field(f, 'prorate') === 'on' }); return 'Leave type updated.'; });
}
async function leaveArchive(_p: unknown, f: FormData) { 'use server'; return mutate(['/admin/attendance', '/leave'], async (c) => { await archiveLeaveType(c, field(f, 'id')); return 'Leave type archived.'; }); }

async function leaveType(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/admin/attendance'], async (c) => { await addLeaveType(c, field(f, 'name'), Number(field(f, 'days')) || 0, field(f, 'paid') === 'on', { carryOverMax: Number(field(f, 'carry')) || 0, prorate: field(f, 'prorate') === 'on' }); return 'Leave type added.'; });
}

export default async function AttendanceSetup() {
  return page(async (p) => {
    need(p.ctx, 'attendance:manage');
    const [shifts, workplaces, leaveTypes, people] = await Promise.all([
      listShifts(p.ctx.q), listWorkplaces(p.ctx.q), listLeaveTypes(p.ctx.q), p.ctx.q.query<any>(`select id, full_name from employees where status in ('active','on_leave') order by full_name`),
    ]);
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Shifts, workplaces &amp; leave</h1>
        <p className="text-sm text-muted">Everything here is configuration. Shift names, times and workplaces are yours to define.</p>

        <section className="card" aria-labelledby="sh"><h2 id="sh" className="font-semibold">Shifts</h2>
          <ul className="mt-2 divide-y divide-line text-sm">{shifts.map((s) => <li key={s.id} className="py-2"><div className="flex justify-between"><span><strong>{s.name}</strong> <span className="text-muted">({s.code})</span></span><span>{s.start}–{s.end}{s.end <= s.start ? ' (overnight)' : ''} · grace {s.graceMin} min</span></div>
            <details className="mt-1"><summary className="cursor-pointer text-xs text-muted underline">Edit or archive</summary>
              <ActionForm action={shiftEdit as any} submit="Save shift" className="mt-2"><input type="hidden" name="id" value={s.id} /><div className="grid gap-x-3 sm:grid-cols-5"><Field label="Name" name="name" required defaultValue={s.name} /><Field label="Start" name="start" type="time" required defaultValue={s.start} /><Field label="End" name="end" type="time" required defaultValue={s.end} /><Field label="Grace (min)" name="grace" type="number" defaultValue={String(s.graceMin)} /><Field label="Early window (min)" name="early" type="number" defaultValue={String(s.earlyMin)} /></div></ActionForm>
              <ActionForm action={shiftArchive as any} submit="Archive shift" tone="danger" confirm="Archive this shift? It cannot be rostered afterwards." className="mt-2"><input type="hidden" name="id" value={s.id} /></ActionForm></details></li>)}</ul>
          <ActionForm action={shift as any} submit="Add shift" className="mt-4 border-t border-line pt-4"><div className="grid gap-x-4 sm:grid-cols-5">
            <Field label="Name" name="name" required /><Field label="Code" name="code" required /><Field label="Start" name="start" type="time" required /><Field label="End" name="end" type="time" required /><Field label="Grace (min)" name="grace" type="number" defaultValue="10" /></div>
            <p className="text-xs text-muted">If the end time is earlier than the start, the shift crosses midnight (for example 22:00 to 06:00).</p></ActionForm></section>

        <section className="card" aria-labelledby="wp"><h2 id="wp" className="font-semibold">Workplaces</h2>
          <ul className="mt-2 divide-y divide-line text-sm">{workplaces.map((w) => (
            <li key={w.id} className="py-2"><strong>{w.name}</strong> <span className="badge">{w.kind}</span> {!w.active && <span className="badge">inactive</span>}
              <p className="text-muted">{w.latitude != null ? <>{w.latitude}, {w.longitude} · radius {w.radius_m} m · <a className="underline" href={`https://www.openstreetmap.org/?mlat=${w.latitude}&mlon=${w.longitude}#map=17/${w.latitude}/${w.longitude}`} target="_blank" rel="noreferrer">view on map</a></> : 'No fixed location (remote/field)'}</p></li>))}</ul>
          <ActionForm action={workplace as any} submit="Add workplace" className="mt-4 border-t border-line pt-4">
            <div className="grid gap-x-4 sm:grid-cols-2"><Field label="Name" name="name" required />
              <Select label="Type" name="kind" allowEmpty={false} defaultValue="office" options={['headquarters', 'branch', 'office', 'temporary', 'field', 'remote'].map((k) => ({ value: k, label: k }))} />
              <Field label="Address" name="address" /><Field label="Radius (metres)" name="radius" type="number" defaultValue="150" hint="Allowed distance from the pin. GPS accuracy widens this slightly." />
              <Field label="Latitude" name="latitude" type="number" /><Field label="Longitude" name="longitude" type="number" />
              <Field label="Valid from (temporary sites)" name="validFrom" type="date" /><Field label="Valid to" name="validTo" type="date" /></div>
            <UseMyLocation latId="latitude" lngId="longitude" />
            <p className="text-xs text-muted">Tip: stand at the entrance and use your current location, or paste coordinates from any map. Remote and field types need no coordinates.</p></ActionForm></section>

        <section className="card" aria-labelledby="as"><h2 id="as" className="font-semibold">Assign a workplace to someone</h2>
          <p className="text-sm text-muted">Staff in a branch automatically get that branch&apos;s workplaces. Use this for temporary, field or remote arrangements.</p>
          <ActionForm action={assign as any} submit="Assign" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-3">
            <Select label="Employee" name="employeeId" required allowEmpty={false} options={people.map((x: any) => ({ value: x.id, label: x.full_name }))} />
            <Select label="Workplace" name="workplaceId" required allowEmpty={false} options={workplaces.filter((w) => w.active).map((w) => ({ value: w.id, label: w.name }))} />
            <Select label="Arrangement" name="kind" allowEmpty={false} defaultValue="primary" options={['primary', 'secondary', 'temporary', 'field', 'remote'].map((k) => ({ value: k, label: k }))} />
            <Field label="From" name="validFrom" type="date" /><Field label="To (optional)" name="validTo" type="date" /></div></ActionForm></section>

        <section className="card" aria-labelledby="lt"><h2 id="lt" className="font-semibold">Leave types</h2>
          <ul className="mt-2 divide-y divide-line text-sm">{leaveTypes.map((t: any) => <li key={t.id} className="py-2"><div className="flex justify-between"><span>{t.name}</span><span className="text-muted">{Number(t.annual_days) > 0 ? `${Number(t.annual_days)} days/year` : 'not capped'} · {t.paid ? 'paid' : 'unpaid'}{Number(t.carry_over_max) > 0 ? ` · carry up to ${Number(t.carry_over_max)}` : ''}{t.prorate ? ' · pro-rata' : ''}</span></div>
            <details className="mt-1"><summary className="cursor-pointer text-xs text-muted underline">Edit or archive</summary>
              <ActionForm action={leaveEdit as any} submit="Save leave type" className="mt-2"><input type="hidden" name="id" value={t.id} /><div className="grid gap-x-3 sm:grid-cols-3"><Field label="Name" name="name" required defaultValue={t.name} /><Field label="Days per year (0 = not capped)" name="days" type="number" defaultValue={String(Number(t.annual_days))} /><Field label="Carry-over limit (days)" name="carry" type="number" defaultValue={String(Number(t.carry_over_max))} /></div>
                <div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" name="paid" defaultChecked={!!t.paid} className="h-5 w-5" /> Paid</label><label className="flex items-center gap-2"><input type="checkbox" name="prorate" defaultChecked={!!t.prorate} className="h-5 w-5" /> Pro-rata for new joiners</label></div></ActionForm>
              <ActionForm action={leaveArchive as any} submit="Archive leave type" tone="danger" confirm="Archive this leave type?" className="mt-2"><input type="hidden" name="id" value={t.id} /></ActionForm></details></li>)}</ul>
          <ActionForm action={leaveType as any} submit="Add leave type" className="mt-4 border-t border-line pt-4"><div className="grid gap-x-4 sm:grid-cols-3"><Field label="Name" name="name" required /><Field label="Days per year (0 = not capped)" name="days" type="number" defaultValue="0" />
            <Field label="Carry-over limit (days)" name="carry" type="number" defaultValue="0" /><label className="mt-7 flex items-center gap-2 text-sm"><input type="checkbox" name="paid" defaultChecked className="h-5 w-5" /> Paid</label><label className="mt-7 flex items-center gap-2 text-sm"><input type="checkbox" name="prorate" defaultChecked className="h-5 w-5" /> Pro-rata for new joiners</label></div></ActionForm></section>
      </div>
    );
  });
}
