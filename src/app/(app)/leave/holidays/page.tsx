import { page, mutate, field } from '@/server/session';
import { addFixedHolidays, addHoliday, listHolidays, removeHoliday } from '@/server/holidays';
import { need } from '@/server/ctx';
import { ActionForm, Field } from '@/components/forms';
import { Notice } from '@/components/ui';

export const metadata = { title: 'Public holidays' };
export const dynamic = 'force-dynamic';

async function add(_p: unknown, f: FormData) { 'use server'; return mutate(['/leave/holidays'], async (c) => { await addHoliday(c, field(f, 'date'), field(f, 'name')); return 'Added.'; }); }
async function fixed(_p: unknown, f: FormData) { 'use server'; return mutate(['/leave/holidays'], async (c) => `Added ${await addFixedHolidays(c, Number(field(f, 'year')))} fixed-date holiday(s).`); }
async function remove(_p: unknown, f: FormData) { 'use server'; return mutate(['/leave/holidays'], async (c) => { await removeHoliday(c, field(f, 'id')); return 'Removed.'; }); }

export default async function Holidays({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const sp = await searchParams;
  const year = Number(sp.year) || new Date().getUTCFullYear();
  return page(async (p) => {
    p.requireFeature('attendance');
    need(p.ctx, 'leave:manage');
    const rows = await listHolidays(p.ctx, year);
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <h1 className="text-2xl font-bold">Public holidays {year}</h1>
        <Notice>Holidays are not counted as leave days. Fixed-date holidays can be added in one click; moveable ones (Good Friday, Easter Monday, Eid) change every year and must be added by hand. Check dates against the official announcement.</Notice>
        <section className="card"><ActionForm action={fixed as any} submit={`Add fixed-date holidays for ${year}`} tone="ghost"><input type="hidden" name="year" value={year} /></ActionForm></section>
        <section className="card"><h2 className="font-semibold">Add a holiday</h2><ActionForm action={add as any} submit="Add" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-2"><Field label="Date" name="date" type="date" required /><Field label="Name" name="name" required /></div></ActionForm></section>
        <section className="card"><ul className="divide-y divide-line text-sm">{rows.length === 0 ? <li className="py-2 text-muted">None listed for {year}.</li> : rows.map((h: any) => <li key={h.id} className="flex items-center justify-between gap-3 py-2"><span>{h.d} · {h.name}</span><ActionForm action={remove as any} submit="Remove" tone="ghost" className="!mt-0"><input type="hidden" name="id" value={h.id} /></ActionForm></li>)}</ul></section>
      </div>
    );
  });
}
