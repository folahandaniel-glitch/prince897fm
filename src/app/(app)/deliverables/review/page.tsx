import { page, mutate, field } from '@/server/session';
import { reviewQueue, reviewDeliverable } from '@/server/deliverables';
import { need } from '@/server/ctx';
import { ActionForm } from '@/components/forms';
import { PageHead, Empty } from '@/components/ui';

export const metadata = { title: 'Review deliverables' };
export const dynamic = 'force-dynamic';

async function decide(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/deliverables/review'], async (c) => { const ok = field(f, 'intent') === 'approve'; await reviewDeliverable(c, field(f, 'id'), ok, field(f, 'note')); return ok ? 'Approved.' : 'Returned for changes.'; });
}

export default async function Review() {
  return page(async (p) => {
    need(p.ctx, 'deliverable:review');
    const rows = await reviewQueue(p.ctx);
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHead title="Review deliverables" sub="Approve good work, or return it with a note on what to change." />
        {rows.length === 0 ? <Empty title="Nothing waiting" text="New submissions from your team appear here." /> : rows.map((r: any) => (
          <section key={r.id} className="card"><div className="flex flex-wrap justify-between gap-2"><div><p className="font-semibold">{r.title}</p><p className="text-xs text-muted">{r.full_name} · {r.department ?? '—'} · {r.def} · {r.period}{r.on_time === false ? ' · late' : ''}</p></div>{r.link && <a className="btn-ghost" href={r.link} target="_blank" rel="noopener noreferrer">Open work</a>}</div>
            {r.notes && <p className="mt-2 text-sm">{r.notes}</p>}
            <ActionForm action={decide as any} submit="Approve" className="mt-3" buttons={[{ label: 'Approve', value: 'approve' }, { label: 'Return', value: 'return', tone: 'ghost' }]}>
              <input type="hidden" name="id" value={r.id} /><label className="label" htmlFor={`n${r.id}`}>Note (required when returning)</label><input id={`n${r.id}`} name="note" className="input" /></ActionForm></section>))}
      </div>
    );
  });
}
