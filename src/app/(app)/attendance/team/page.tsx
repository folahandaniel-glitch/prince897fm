import { page, mutate, field } from '@/server/session';
import { pendingExceptions, reviewException, teamBoard } from '@/server/attendance';
import { can } from '@/domain/policy';
import { ActionForm, Field } from '@/components/forms';

export const metadata = { title: 'Team attendance' };
export const dynamic = 'force-dynamic';

async function decide(_p: unknown, f: FormData) {
  'use server';
  const approve = field(f, 'decision') === 'approve';
  return mutate(['/attendance/team'], async (c) => { await reviewException(c, field(f, 'id'), approve, field(f, 'note')); return approve ? 'Approved.' : 'Rejected.'; });
}

const LABEL: Record<string, string> = { present: 'Present', late: 'Late', absent: 'Absent', leave: 'On leave', off: 'Not rostered' };
const TONE: Record<string, string> = { present: 'bg-emerald-100 text-emerald-900', late: 'bg-amber-100 text-amber-900', absent: 'bg-red-100 text-red-900', leave: 'bg-sky-100 text-sky-900', off: '' };
const tm = (d: any, tz: string) => (d ? new Date(d).toLocaleTimeString('en-NG', { timeZone: tz, hour: '2-digit', minute: '2-digit' }) : '—');

export default async function TeamAttendance({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const sp = await searchParams;
  return page(async (p) => {
    const b = await teamBoard(p.ctx, sp.date);
    const canReview = can(p.ctx.subject, 'attendance:review').allow;
    const pending = canReview ? await pendingExceptions(p.ctx) : [];
    const S = b.summary;
    return (
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold">Team attendance</h1><p className="text-sm text-muted">{b.date}</p></div>
          <form className="flex items-end gap-2"><div><label className="label" htmlFor="date">Date</label><input id="date" name="date" type="date" defaultValue={b.date} className="input" /></div><button className="btn-ghost">Go</button></form></header>

        <section aria-label="Summary" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {([['Present', S.present], ['Late', S.late], ['Absent', S.absent], ['Missing clock-out', S.missingClockOut], ['Needs review', S.flagged]] as const).map(([k, v]) => (
            <div key={k} className="card !p-4"><p className="text-xs text-muted">{k}</p><p className="text-2xl font-bold">{v}</p></div>))}
        </section>

        {canReview && (
          <section aria-labelledby="pend" className="space-y-3"><h2 id="pend" className="font-semibold">Requests awaiting your review ({pending.length})</h2>
            {pending.length === 0 ? <div className="card text-sm text-muted">Nothing waiting. Explanations and corrections from your team will appear here.</div> :
              pending.map((x: any) => (
                <article key={x.id} className="card"><p className="font-medium">{x.full_name} <span className="font-normal text-muted">· {x.department ?? '—'} · {x.wd} · {x.kind.replace(/_/g, ' ')}</span></p>
                  <p className="mt-1 text-sm">{x.note}</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <ActionForm action={decide as any} submit="Approve" className=""><input type="hidden" name="id" value={x.id} /><input type="hidden" name="decision" value="approve" /><Field label="Note (optional)" name="note" /></ActionForm>
                    <ActionForm action={decide as any} submit="Reject" tone="danger" confirm="Reject this request?"><input type="hidden" name="id" value={x.id} /><input type="hidden" name="decision" value="reject" /><Field label="Reason (required)" name="note" /></ActionForm>
                  </div></article>))}
          </section>)}

        <section aria-labelledby="board"><h2 id="board" className="mb-2 font-semibold">Today&apos;s board</h2>
          {b.board.length === 0 ? <div className="card text-sm text-muted">No staff in your scope.</div> : (
            <div className="card overflow-x-auto p-0"><table className="w-full"><thead><tr className="border-b border-line"><th className="th">Name</th><th className="th">Department</th><th className="th">Shift</th><th className="th">In</th><th className="th">Out</th><th className="th">Status</th><th className="th">Notes</th></tr></thead>
              <tbody>{b.board.map((r: any) => (
                <tr key={r.id} className="border-b border-line last:border-0"><td className="td font-medium">{r.full_name}</td><td className="td">{r.department ?? '—'}</td><td className="td">{r.shift_name ?? '—'}</td>
                  <td className="td">{tm(r.clock_in_at, p.org.timezone)}</td><td className="td">{tm(r.clock_out_at, p.org.timezone)}</td>
                  <td className="td"><span className={`badge ${TONE[r.status]}`}>{LABEL[r.status]}{r.status === 'late' ? ` ${r.late_minutes}m` : ''}</span></td>
                  <td className="td text-xs text-muted">{r.missingClockOut ? 'Missing clock-out. ' : ''}{(r.flags ?? []).filter((f: string) => f !== 'late').join(', ').replace(/_/g, ' ')}</td></tr>))}</tbody></table></div>)}
        </section>
      </div>
    );
  });
}
