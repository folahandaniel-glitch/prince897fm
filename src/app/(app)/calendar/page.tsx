import Link from 'next/link';
import { page, mutate, field } from '@/server/session';
import { createEvent, monthView } from '@/server/calendar';
import { addDays } from '@/domain/attendance';
import { ActionForm, Field, Select } from '@/components/forms';
import { PageHead } from '@/components/ui';

export const metadata = { title: 'Calendar' };
export const dynamic = 'force-dynamic';

async function add(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/calendar'], async (c) => { await createEvent(c, { title: field(f, 'title'), kind: field(f, 'kind'), startsAt: new Date(field(f, 'starts')).toISOString(), endsAt: field(f, 'ends') ? new Date(field(f, 'ends')).toISOString() : undefined, location: field(f, 'location'), description: field(f, 'description'), roles: field(f, 'who') === 'managers' ? ['hr_manager', 'department_head', 'executive', 'ceo', 'tenant_admin'] : ['*'] }); return 'Event added to the calendar.'; });
}
const DOT: Record<string, string> = { shift: 'bg-sky-500', leave: 'bg-emerald-500', task: 'bg-amber-500', report: 'bg-red-500', meeting: 'bg-indigo-500', event: 'bg-fuchsia-500', deadline: 'bg-red-500', training: 'bg-teal-500', other: 'bg-slate-400' };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  return page(async (p) => {
    p.requireFeature('calendar');
    const month = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : new Date().toISOString().slice(0, 7);
    const v = await monthView(p.ctx, month);
    const first = new Date(`${month}-01T00:00:00Z`);
    const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7;
    const prev = addDays(`${month}-01`, -1).slice(0, 7), next = addDays(`${month}-01`, 32).slice(0, 7);
    const by = new Map<string, typeof v.items>();
    for (const i of v.items) (by.get(i.date) ?? by.set(i.date, []).get(i.date)!).push(i);
    const today = new Date().toISOString().slice(0, 10);
    return (
      <div className="space-y-5">
        <PageHead title={first.toLocaleDateString(p.org.locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })} sub="Your shifts, leave, task deadlines, report deadlines and events.">
          <Link className="btn-ghost" href={`?m=${prev}`}>← Prev</Link><Link className="btn-ghost" href={`?m=${new Date().toISOString().slice(0, 7)}`}>Today</Link><Link className="btn-ghost" href={`?m=${next}`}>Next →</Link></PageHead>
        <div className="hidden gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid md:grid-cols-7" role="grid" aria-label="Month">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="bg-surface px-2 py-1 text-xs font-semibold text-muted" role="columnheader">{d}</div>)}
          {Array.from({ length: lead }).map((_, i) => <div key={`l${i}`} className="min-h-[5.5rem] bg-surface/60" />)}
          {Array.from({ length: days }, (_, i) => { const d = `${month}-${String(i + 1).padStart(2, '0')}`; const items = by.get(d) ?? []; return (
            <div key={d} role="gridcell" className={`min-h-[5.5rem] bg-panel p-1.5 ${d === today ? 'ring-2 ring-inset ring-accent' : ''}`}><p className="text-xs font-semibold">{i + 1}</p>
              <ul className="mt-0.5 space-y-0.5">{items.slice(0, 3).map((it, j) => <li key={j} className="flex items-center gap-1 truncate text-[11px]" title={`${it.title}${it.time ? ' ' + it.time : ''}`}><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[it.kind]}`} />{it.href ? <Link href={it.href} className="truncate hover:underline">{it.title}</Link> : <span className="truncate">{it.title}</span>}</li>)}{items.length > 3 && <li className="text-[11px] text-muted">+{items.length - 3} more</li>}</ul></div>); })}
        </div>
        <section className="card md:hidden" aria-label="Agenda"><h2 className="font-semibold">Agenda</h2>{v.items.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing scheduled this month.</p> : <ul className="mt-2 divide-y divide-line text-sm">{v.items.map((it, i) => <li key={i} className="flex items-start gap-3 py-2"><span className="w-12 shrink-0 text-xs font-semibold text-muted">{it.date.slice(8)}</span><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[it.kind]}`} /><span>{it.href ? <Link href={it.href} className="underline">{it.title}</Link> : it.title}<span className="block text-xs text-muted">{[it.time, it.sub].filter(Boolean).join(' · ')}</span></span></li>)}</ul>}</section>
        <p className="flex flex-wrap gap-3 text-xs text-muted">{Object.entries({ shift: 'Shift', leave: 'Leave', task: 'Task due', report: 'Report due', meeting: 'Meeting', event: 'Event' }).map(([k, l]) => <span key={k} className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${DOT[k]}`} />{l}</span>)}</p>
        {p.allowed('event:create') && <section className="card" aria-labelledby="ev"><h2 id="ev" className="font-semibold">Add an event or meeting</h2>
          <ActionForm action={add as any} submit="Add to calendar" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-3"><Field label="Title" name="title" required /><Select label="Type" name="kind" allowEmpty={false} defaultValue="meeting" options={['meeting', 'event', 'deadline', 'training', 'other'].map((x) => ({ value: x, label: x }))} /><Select label="Who sees it" name="who" allowEmpty={false} defaultValue="all" options={[{ value: 'all', label: 'Everyone' }, { value: 'managers', label: 'Managers only' }]} /><Field label="Starts" name="starts" type="datetime-local" required /><Field label="Ends" name="ends" type="datetime-local" /><Field label="Location" name="location" /></div><Field label="Details" name="description" /></ActionForm></section>}
      </div>
    );
  });
}
