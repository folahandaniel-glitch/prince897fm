import Link from 'next/link';
import { page, mutate, field } from '@/server/session';
import { assignRoster, cancelRoster, listShifts, weekRoster } from '@/server/attendance';
import { addDays } from '@/domain/attendance';
import { need } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';

export const metadata = { title: 'Roster' };
export const dynamic = 'force-dynamic';

async function assign(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/roster'], async (c) => {
    const from = field(f, 'from'), to = field(f, 'to') || from;
    const weekdaysOnly = field(f, 'weekdays') === 'on';
    const dates: string[] = [];
    for (let d = from; d && d <= to && dates.length < 62; d = addDays(d, 1)) {
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      if (!weekdaysOnly || (dow !== 0 && dow !== 6)) dates.push(d);
    }
    const r = await assignRoster(c, { employeeId: field(f, 'employeeId'), shiftId: field(f, 'shiftId'), dates });
    const parts = [`Published ${r.created.length} shift(s).`];
    if (r.warnings.length) parts.push(`Warnings: ${[...new Set(r.warnings)].join(' ')}`);
    if (r.blocked.length) parts.push(`Not published: ${r.blocked.join(' ')}`);
    return parts.join(' ');
  });
}
async function cancel(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/roster'], async (c) => { await cancelRoster(c, field(f, 'id'), field(f, 'reason')); return 'Shift cancelled.'; });
}

function mondayOf(d: string) { const x = new Date(`${d}T00:00:00Z`); const dow = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - dow); return x.toISOString().slice(0, 10); }

export default async function RosterPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const sp = await searchParams;
  return page(async (p) => {
    need(p.ctx, 'roster:manage');
    const start = mondayOf(sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : new Date().toISOString().slice(0, 10));
    const [grid, shifts] = await Promise.all([weekRoster(p.ctx, start), listShifts(p.ctx.q)]);
    const byCell = new Map<string, any[]>();
    for (const e of grid.entries) { const k = `${e.employee_id}|${e.d}`; (byCell.get(k) ?? byCell.set(k, []).get(k)!).push(e); }
    const covered = new Map<string, number>();
    for (const e of grid.entries) covered.set(e.d, (covered.get(e.d) ?? 0) + 1);
    return (
      <div className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">Roster</h1>
          <nav className="flex items-center gap-2" aria-label="Week"><Link className="btn-ghost" href={`?week=${addDays(start, -7)}`}>← Previous</Link><span className="text-sm font-medium">Week of {start}</span><Link className="btn-ghost" href={`?week=${addDays(start, 7)}`}>Next →</Link></nav></header>

        {grid.employees.length === 0 ? <div className="card text-sm text-muted">No staff in your scope yet.</div> : (
          <div className="card overflow-x-auto p-0"><table className="w-full min-w-[40rem]"><thead><tr className="border-b border-line"><th className="th">Staff</th>{grid.days.map((d) => <th key={d} className="th">{new Date(`${d}T00:00:00Z`).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })}</th>)}</tr></thead>
            <tbody>{grid.employees.map((e: any) => (
              <tr key={e.id} className="border-b border-line last:border-0"><td className="td font-medium">{e.full_name}</td>
                {grid.days.map((d) => (<td key={d} className="td">{(byCell.get(`${e.id}|${d}`) ?? []).map((x) => <span key={x.id} className="badge mr-1" title={`${x.name} ${String(x.start_time).slice(0, 5)}–${String(x.end_time).slice(0, 5)}`}>{x.code}</span>)}</td>))}</tr>))}
              <tr className="bg-surface"><td className="td text-xs font-semibold text-muted">Staff rostered</td>{grid.days.map((d) => <td key={d} className="td text-xs font-semibold">{covered.get(d) ?? 0}</td>)}</tr></tbody></table></div>)}

        <section className="card" aria-labelledby="as"><h2 id="as" className="font-semibold">Assign shifts</h2>
          <p className="text-sm text-muted">Conflicts (overlaps, leave, double booking) are blocked; short rest periods are warned. Nothing is published silently.</p>
          <ActionForm action={assign as any} submit="Publish roster" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-3">
            <Select label="Employee" name="employeeId" required allowEmpty={false} options={grid.employees.map((e: any) => ({ value: e.id, label: e.full_name }))} />
            <Select label="Shift" name="shiftId" required allowEmpty={false} options={shifts.map((s) => ({ value: s.id, label: `${s.name} (${s.start}–${s.end})` }))} />
            <label className="mt-7 flex items-center gap-2 text-sm"><input type="checkbox" name="weekdays" defaultChecked className="h-5 w-5" /> Weekdays only</label>
            <Field label="From" name="from" type="date" required defaultValue={start} /><Field label="To (optional)" name="to" type="date" defaultValue={addDays(start, 4)} /></div></ActionForm></section>

        {grid.entries.length > 0 && (
          <section className="card" aria-labelledby="ce"><h2 id="ce" className="font-semibold">Cancel a rostered shift</h2>
            <ActionForm action={cancel as any} submit="Cancel shift" tone="danger" className="mt-3" confirm="Cancel this rostered shift?"><div className="grid gap-x-4 sm:grid-cols-2">
              <Select label="Entry" name="id" required allowEmpty={false} options={grid.entries.map((x: any) => ({ value: x.id, label: `${x.d} · ${grid.employees.find((e: any) => e.id === x.employee_id)?.full_name ?? ''} · ${x.code}` }))} />
              <Field label="Reason" name="reason" required /></div></ActionForm></section>)}
      </div>
    );
  });
}
