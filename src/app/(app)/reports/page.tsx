import { page, mutate, field } from '@/server/session';
import { myReports, submitReport, type FieldDef } from '@/server/reports';
import { ActionForm } from '@/components/forms';

export const metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

async function save(_p: unknown, f: FormData) {
  'use server';
  const id = field(f, 'id');
  const submit = field(f, 'intent') === 'submit';
  return mutate(['/reports', '/dashboard'], async (c) => {
    const answers: Record<string, string> = {};
    for (const [k, v] of f.entries()) if (k.startsWith('a_')) answers[k.slice(2)] = String(v);
    return (await submitReport(c, id, answers, submit)).message;
  });
}

const STATE: Record<string, { text: string; cls: string }> = {
  open: { text: 'Open', cls: '' }, due_soon: { text: 'Due soon', cls: 'bg-amber-100 text-amber-900' }, overdue: { text: 'Overdue', cls: 'bg-red-100 text-red-900' }, done: { text: 'Submitted', cls: 'bg-emerald-100 text-emerald-900' },
};

export default async function ReportsPage() {
  return page(async (p) => {
    const list = await myReports(p.ctx);
    const fmt = (d: any) => new Date(d).toLocaleString(p.org.locale, { timeZone: p.org.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const current = list.filter((r) => ['draft', 'returned'].includes(r.status));
    const past = list.filter((r) => !['draft', 'returned'].includes(r.status));
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-2xl font-bold">My reports</h1>
        {current.length === 0 ? <div className="card text-center"><p className="font-semibold">Nothing to submit right now</p><p className="mt-1 text-sm text-muted">Your next weekly or monthly report will appear here when its period opens.</p></div> :
          current.map((r) => (
            <article key={r.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{r.name} <span className="font-normal text-muted">· {r.ps} → {r.pe}</span></h2>
                <span className={`badge ${STATE[r.state].cls}`}>{r.status === 'returned' ? 'Returned' : STATE[r.state].text}</span></div>
              <p className="text-sm text-muted">Due {fmt(r.due_at)}</p>
              {r.status === 'returned' && r.last_note && <p className="mt-2 rounded-lg border border-line p-3 text-sm"><strong>Reviewer note:</strong> {r.last_note}</p>}
              <ActionForm action={save as any} submit="Submit for review" className="mt-3" buttons={[{ label: 'Save draft', value: 'draft', tone: 'ghost' }, { label: 'Submit for review', value: 'submit' }]}>
                <input type="hidden" name="id" value={r.id} />
                {(r.fields as FieldDef[]).map((f) => (
                  <div key={f.key} className="mb-3"><label className="label" htmlFor={`${r.id}-${f.key}`}>{f.label}{f.required && <span aria-hidden> *</span>}</label>
                    {f.type === 'longtext'
                      ? <textarea id={`${r.id}-${f.key}`} name={`a_${f.key}`} rows={4} defaultValue={r.answers?.[f.key] ?? ''} className="input py-2" />
                      : <input id={`${r.id}-${f.key}`} name={`a_${f.key}`} type={f.type === 'number' ? 'number' : 'text'} step="any" defaultValue={r.answers?.[f.key] ?? ''} className="input" />}</div>))}
              </ActionForm>
            </article>))}

        <section className="card" aria-labelledby="past"><h2 id="past" className="font-semibold">History</h2>
          {past.length === 0 ? <p className="mt-2 text-sm text-muted">Submitted reports will be listed here with their review status.</p> :
            <ul className="mt-2 divide-y divide-line text-sm">{past.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><span className="font-medium">{r.name}</span> · {r.ps} → {r.pe}</span>
                <span className="flex gap-1"><span className="badge">{r.status.replace('_', ' ')}</span>{r.on_time === false && <span className="badge bg-amber-100 text-amber-900">late</span>}</span></li>))}</ul>}</section>
      </div>
    );
  });
}
