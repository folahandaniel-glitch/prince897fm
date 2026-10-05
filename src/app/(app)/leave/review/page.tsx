import { page, mutate, field } from '@/server/session';
import { pendingLeave, reviewLeave } from '@/server/attendance';
import { ActionForm, Field } from '@/components/forms';

export const metadata = { title: 'Leave requests' };
export const dynamic = 'force-dynamic';

async function decide(_p: unknown, f: FormData) {
  'use server';
  const approve = field(f, 'decision') === 'approve';
  return mutate(['/leave/review', '/roster'], async (c) => { const n = await reviewLeave(c, field(f, 'id'), approve, field(f, 'note')); return approve ? `Approved. ${n}` : 'Rejected.'; });
}

export default async function LeaveReview() {
  return page(async (p) => {
    const reqs = await pendingLeave(p.ctx);
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Leave requests</h1>
        {reqs.length === 0 ? <div className="card text-center"><p className="font-semibold">Nothing waiting</p><p className="mt-1 text-sm text-muted">Requests from your team will appear here.</p></div> :
          reqs.map((r: any) => (
            <article key={r.id} className="card"><p className="font-medium">{r.full_name} <span className="font-normal text-muted">· {r.department ?? '—'}</span></p>
              <p className="text-sm">{r.type}: {r.s} → {r.e} ({Number(r.days)} working day(s)){r.reason ? ` · ${r.reason}` : ''}</p>
              {r.rostered > 0 && <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">{r.rostered} rostered shift(s) fall in this period. Approving releases them for reassignment.</p>}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <ActionForm action={decide as any} submit="Approve"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="approve" /><Field label="Note (optional)" name="note" /></ActionForm>
                <ActionForm action={decide as any} submit="Reject" tone="danger" confirm="Reject this leave request?"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="reject" /><Field label="Reason (required)" name="note" /></ActionForm>
              </div></article>))}
      </div>
    );
  });
}
