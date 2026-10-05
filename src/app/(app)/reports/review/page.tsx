import { page, mutate, field } from '@/server/session';
import { decideReport, reviewQueue, type FieldDef } from '@/server/reports';
import { ActionForm, Field } from '@/components/forms';

export const metadata = { title: 'Report reviews' };
export const dynamic = 'force-dynamic';

async function decide(_p: unknown, f: FormData) {
  'use server';
  const decision = field(f, 'intent') as 'approved' | 'returned' | 'rejected';
  if (!['approved', 'returned', 'rejected'].includes(decision)) return { error: 'Choose a decision.' };
  return mutate(['/reports/review', '/reports'], async (c) => {
    const s = await decideReport(c, field(f, 'id'), decision, field(f, 'note'));
    return s === 'approved' ? 'Approved. The report is complete.' : s === 'under_review' ? 'Approved. Sent to the next reviewer.' : `Report ${decision}.`;
  });
}

export default async function ReportReview() {
  return page(async (p) => {
    const q = await reviewQueue(p.ctx);
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Report reviews</h1>
        <p className="text-sm text-muted">Only reports waiting at your stage are shown. The supervisor and department are as they were when the report was submitted.</p>
        {q.length === 0 ? <div className="card text-center"><p className="font-semibold">Nothing waiting for you</p><p className="mt-1 text-sm text-muted">Submitted reports will appear here at your approval stage.</p></div> :
          q.map((r: any) => (
            <article key={r.id} className="card">
              <h2 className="font-semibold">{r.template} <span className="font-normal text-muted">· {r.full_name} · {r.ctx_department ?? '—'} · {r.ps} → {r.pe}</span></h2>
              <p className="text-xs text-muted">Submitted {new Date(r.submitted_at).toLocaleString(p.org.locale, { timeZone: p.org.timezone })} {r.on_time === false ? '· LATE' : '· on time'} · Stage {r.step + 1} of {r.chain_snapshot.length}{r.ctx_supervisor ? ` · Supervisor of record: ${r.ctx_supervisor}` : ''}</p>
              <dl className="mt-3 space-y-2 text-sm">{(r.fields as FieldDef[]).map((f) => <div key={f.key}><dt className="font-medium">{f.label}</dt><dd className="whitespace-pre-wrap text-muted">{r.answers?.[f.key] || '—'}</dd></div>)}</dl>
              {(r.reviews as any[]).length > 0 && <p className="mt-2 text-xs text-muted">Earlier decisions: {(r.reviews as any[]).map((v) => `${v.decision}${v.note ? ` (${v.note})` : ''}`).join('; ')}</p>}
              <ActionForm action={decide as any} submit="Approve" className="mt-3" buttons={[{ label: 'Approve', value: 'approved' }, { label: 'Return for changes', value: 'returned', tone: 'ghost' }, { label: 'Reject', value: 'rejected', tone: 'danger' }]}>
                <input type="hidden" name="id" value={r.id} /><Field label="Note (required to return or reject)" name="note" />
              </ActionForm>
            </article>))}
      </div>
    );
  });
}
