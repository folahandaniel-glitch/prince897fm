import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page, mutate, field } from '@/server/session';
import { archiveRecord, getRecord, transitionRecord, updateRecord } from '@/server/builders';
import { DynFields, showValue } from '@/components/dyn-fields';
import { ActionForm, Field } from '@/components/forms';
import { PageHead } from '@/components/ui';

export const dynamic = 'force-dynamic';
const paths = (k: string, id: string) => [`/m/${k}`, `/m/${k}/${id}`];
const collect = (f: FormData) => { const o: Record<string, unknown> = {}; for (const k of new Set([...f.keys()])) if (!['module', 'id'].includes(k) && !k.startsWith('$ACTION')) { const a = f.getAll(k).map(String); o[k] = a.length > 1 ? a : a[0]; } return o; };
async function save(_p: unknown, f: FormData) { 'use server'; const k = field(f, 'module'), id = field(f, 'id'); return mutate(paths(k, id), async (c) => { await updateRecord(c, k, id, collect(f)); return 'Saved. The change is recorded in the history.'; }); }
async function step(_p: unknown, f: FormData) { 'use server'; const k = field(f, 'module'), id = field(f, 'id'); return mutate(paths(k, id), async (c) => { await transitionRecord(c, k, id, field(f, 'intent'), field(f, 'note')); return 'Status updated.'; }); }
async function archive(_p: unknown, f: FormData) { 'use server'; const k = field(f, 'module'), id = field(f, 'id'); return mutate(paths(k, id), async (c) => { await archiveRecord(c, k, id, field(f, 'reason')); return 'Archived.'; }); }

export default async function RecordPage({ params }: { params: Promise<{ key: string; id: string }> }) {
  const { key, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return page(async (p) => {
    p.requireFeature('builders');
    const d = await getRecord(p.ctx, key, id);
    if (!d) notFound();
    const { entity: e, rec, history, next, canEdit, canRemove } = d;
    const label = (s: string) => e.statuses.find((x) => x.key === s)?.label ?? s;
    const [people, departments] = await Promise.all([
      canEdit && e.fields.some((f) => f.type === 'employee' && !f.archived) ? p.ctx.q.query<any>(`select id, full_name as name from employees where status = 'active' order by full_name`) : [],
      canEdit && e.fields.some((f) => f.type === 'department' && !f.archived) ? p.ctx.q.query<any>('select id, name from departments where archived_at is null order by name') : [],
    ]);
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <nav className="text-sm text-muted" aria-label="Breadcrumb"><Link className="underline" href={`/m/${key}`}>{e.plural}</Link> / {rec.number}</nav>
        <PageHead title={rec.number} sub={`${e.name} · created ${new Date(rec.created_at).toLocaleDateString(p.org.locale)}${rec.creator ? ` by ${rec.creator}` : ' (public form)'}`}><span className="badge text-sm">{label(rec.status)}</span></PageHead>
        <section className="card"><dl className="grid gap-3 sm:grid-cols-2">{e.fields.filter((f) => !f.archived).map((f) => <div key={f.key} className={f.type === 'longtext' ? 'sm:col-span-2' : ''}><dt className="text-xs uppercase text-muted">{f.label}</dt><dd className="whitespace-pre-wrap text-sm font-medium">{showValue(f, rec.data[f.key])}</dd></div>)}</dl></section>
        {next.length > 0 && <section className="card"><h2 className="font-semibold">Move to</h2><ActionForm action={step as any} submit="Move" className="mt-2" buttons={next.map((s: string) => ({ label: label(s), value: s, tone: 'ghost' as const }))}><input type="hidden" name="module" value={key} /><input type="hidden" name="id" value={id} /><Field label="Note (optional)" name="note" /></ActionForm></section>}
        {canEdit && <details className="card"><summary className="cursor-pointer font-semibold">Edit details</summary><ActionForm action={save as any} submit="Save changes" className="mt-3"><input type="hidden" name="module" value={key} /><input type="hidden" name="id" value={id} /><DynFields fields={e.fields} values={rec.data} people={people} departments={departments} /></ActionForm></details>}
        <section className="card"><h2 className="font-semibold">History</h2><ul className="mt-2 divide-y divide-line text-sm">{history.map((h: any, i: number) => <li key={i} className="py-2"><span className="font-mono text-xs">{h.action}</span> <span className="text-muted">· {h.actor ?? 'public'} · {new Date(h.created_at).toLocaleString(p.org.locale, { timeZone: p.org.timezone })}</span>{h.reason && <span className="block text-muted">{h.reason}</span>}</li>)}</ul></section>
        {canRemove && <section className="card"><h2 className="font-semibold">Archive</h2><ActionForm action={archive as any} submit="Archive" tone="danger" className="mt-2" confirm="Archive this record?"><input type="hidden" name="module" value={key} /><input type="hidden" name="id" value={id} /><Field label="Reason" name="reason" required /></ActionForm></section>}
      </div>
    );
  });
}
