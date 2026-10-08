import { page, mutate, field } from '@/server/session';
import { mySubmissions, myExpectations, submitDeliverable } from '@/server/deliverables';
import { ActionForm, Field, Select } from '@/components/forms';
import { PageHead, Empty } from '@/components/ui';

export const metadata = { title: 'My deliverables' };
export const dynamic = 'force-dynamic';

async function submit(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/deliverables'], async (c) => { await submitDeliverable(c, { defId: field(f, 'defId'), title: field(f, 'title'), notes: field(f, 'notes'), link: field(f, 'link'), dueOn: field(f, 'dueOn') || undefined }); return 'Submitted for review.'; });
}
const TONE: Record<string, string> = { approved: 'bg-emerald-100 text-emerald-900', returned: 'bg-red-100 text-red-900', submitted: 'bg-amber-100 text-amber-900' };

export default async function MyDeliverables() {
  const period = new Date().toISOString().slice(0, 7);
  return page(async (p) => {
    const [defs, subs] = await Promise.all([myExpectations(p.ctx, period), mySubmissions(p.ctx, period)]);
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <PageHead title="My deliverables" sub={`What is expected of you in ${period}. Approved items count towards your KPI.`} />
        {defs.length === 0 ? <Empty title="Nothing is expected of you yet" text="Your department head or HR sets the deliverables for your role." /> :
          <section className="grid gap-3 sm:grid-cols-2">{defs.map((d: any) => (
            <div key={d.id} className="card !p-4"><p className="font-semibold">{d.name}</p><p className="text-xs text-muted">{d.frequency} · target {d.target_count} a month</p>
              <p className="mt-2 text-sm"><b>{d.approved}</b> approved of {d.target_count}{d.waiting ? ` · ${d.waiting} waiting` : ''}{d.returned ? ` · ${d.returned} returned` : ''}</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface" role="img" aria-label={`${d.approved} of ${d.target_count}`}><div className="h-full bg-brand" style={{ width: `${Math.min(100, (d.approved / d.target_count) * 100)}%` }} /></div></div>))}</section>}
        {defs.length > 0 && <section className="card"><h2 className="font-semibold">Submit a deliverable</h2>
          <ActionForm action={submit as any} submit="Submit" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-2">
            <Select label="Which deliverable" name="defId" required allowEmpty={false} options={defs.map((d: any) => ({ value: d.id, label: d.name }))} />
            <Field label="Title" name="title" required placeholder="e.g. Morning Drive log, 8 Oct" />
            <Field label="Link to the work (optional)" name="link" type="url" placeholder="https://" /><Field label="Deadline it was due (optional)" name="dueOn" type="date" /></div>
            <div><label className="label" htmlFor="notes">Notes</label><textarea id="notes" name="notes" rows={3} className="input py-2" /></div></ActionForm></section>}
        <section className="card"><h2 className="font-semibold">Submitted this month</h2>
          {subs.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing submitted yet.</p> : <ul className="mt-2 divide-y divide-line text-sm">{subs.map((s: any) => (
            <li key={s.id} className="py-2"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{s.title} <span className="text-muted">· {s.def}</span></span><span className={`badge ${TONE[s.status] ?? ''}`}>{s.status}</span></div>
              {s.review_note && <p className="text-xs text-muted">Reviewer: {s.review_note}</p>}{s.link && <a href={s.link} target="_blank" rel="noopener noreferrer" className="text-xs underline">Open link</a>}</li>))}</ul>}</section>
      </div>
    );
  });
}
