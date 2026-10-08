import { page, mutate, field } from '@/server/session';
import { submitException } from '@/server/attendance';
import { listExcuses } from '@/server/reporthub';
import { ActionForm, Field } from '@/components/forms';
import { PageHead, Empty } from '@/components/ui';

export const metadata = { title: 'Late excuses' };
export const dynamic = 'force-dynamic';

async function send(_p: unknown, f: FormData) { 'use server'; return mutate(['/attendance/excuses'], async (c) => { await submitException(c, { kind: 'late', note: field(f, 'note'), workDate: field(f, 'workDate') || undefined }); return 'Sent to your supervisor.'; }); }
const TONE: Record<string, string> = { approved: 'bg-emerald-100 text-emerald-900', rejected: 'bg-red-100 text-red-900', pending_review: 'bg-amber-100 text-amber-900' };

export default async function Excuses() {
  return page(async (p) => {
    p.requireFeature('attendance');
    const mine = await listExcuses(p.ctx, true);
    const team = p.allowed('attendance:review') ? await listExcuses(p.ctx, false) : [];
    const list = (rows: any[], who: boolean) => rows.length === 0 ? <Empty title="None" /> : <ul className="divide-y divide-line text-sm">{rows.map((r) => <li key={r.id} className="py-2"><div className="flex flex-wrap justify-between gap-2"><span>{who && <b>{r.full_name} · </b>}{r.work_date}</span><span className={`badge ${TONE[r.status] ?? ''}`}>{r.status.replace('_', ' ')}</span></div><p className="text-muted">{r.note}</p>{r.decision_note && <p className="text-xs text-muted">Decision: {r.decision_note}</p>}</li>)}</ul>;
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <PageHead title="Late excuses" sub="Explain a late arrival. Your supervisor approves or declines it from the attendance review queue." />
        <section className="card"><h2 className="font-semibold">Explain a late arrival</h2><ActionForm action={send as any} submit="Send excuse" className="mt-3"><Field label="Date you were late" name="workDate" type="date" /><div><label className="label" htmlFor="note">What happened</label><textarea id="note" name="note" rows={3} required className="input py-2" /></div></ActionForm></section>
        <section className="card"><h2 className="font-semibold">My excuses</h2><div className="mt-2">{list(mine, false)}</div></section>
        {p.allowed('attendance:review') && <section className="card"><h2 className="font-semibold">Team excuses</h2><p className="text-xs text-muted">Decide them in Team attendance.</p><div className="mt-2">{list(team, true)}</div></section>}
      </div>
    );
  });
}
