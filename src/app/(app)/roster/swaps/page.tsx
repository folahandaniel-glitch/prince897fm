import { page, mutate, field } from '@/server/session';
import { decideSwap, swapQueue } from '@/server/swaps';
import { need } from '@/server/ctx';
import { ActionForm, Field } from '@/components/forms';
import { Empty } from '@/components/ui';

export const metadata = { title: 'Shift cover requests' };
export const dynamic = 'force-dynamic';

async function decide(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/roster/swaps', '/roster'], async (c) => { const yes = field(f, 'intent') === 'yes'; await decideSwap(c, field(f, 'id'), yes, field(f, 'note')); return yes ? 'Approved. The roster has been updated.' : 'Declined.'; });
}

export default async function Swaps() {
  return page(async (p) => {
    p.requireFeature('attendance');
    need(p.ctx, 'roster:manage');
    const rows = await swapQueue(p.ctx);
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-bold">Shift cover requests</h1>
        <p className="text-sm text-muted">Both people have agreed. Approving moves the shift on the roster after checking rest hours, leave and overlaps for the colleague.</p>
        {rows.length === 0 ? <Empty title="Nothing waiting" text="Cover requests that need your approval appear here." /> : (
          <ul className="space-y-3">{rows.map((r: any) => (
            <li key={r.id} className="card"><p className="text-sm"><strong>{r.requester}</strong> → <strong>{r.target}</strong> · {r.d} · {r.shift} ({r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}){r.reason && <span className="text-muted"> — {r.reason}</span>}</p>
              <ActionForm action={decide as any} submit="" className="mt-2" buttons={[{ label: 'Approve', value: 'yes' }, { label: 'Decline', value: 'no', tone: 'ghost' }]}><input type="hidden" name="id" value={r.id} /><Field label="Note (required to decline)" name="note" /></ActionForm></li>))}</ul>)}
      </div>
    );
  });
}
