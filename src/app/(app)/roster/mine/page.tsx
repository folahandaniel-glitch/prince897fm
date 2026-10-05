import { page, mutate, field } from '@/server/session';
import { cancelSwap, colleagueReply, colleagueShifts, colleagues, mySwaps, myShifts, requestSwap, SWAP_LABEL } from '@/server/swaps';
import { need } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';
import { Empty } from '@/components/ui';

export const metadata = { title: 'My shifts' };
export const dynamic = 'force-dynamic';

async function ask(_p: unknown, f: FormData) { 'use server'; return mutate(['/roster/mine'], async (c) => { await requestSwap(c, { entryId: field(f, 'entry'), targetEmployeeId: field(f, 'target') || undefined, counterEntryId: field(f, 'counter') || undefined, reason: field(f, 'reason') }); return 'Request sent. Your colleague and then your manager must agree.'; }); }
async function reply(_p: unknown, f: FormData) { 'use server'; return mutate(['/roster/mine'], async (c) => { const yes = field(f, 'intent') === 'yes'; await colleagueReply(c, field(f, 'id'), yes); return yes ? 'Accepted. It now goes to the manager.' : 'Declined.'; }); }
async function withdraw(_p: unknown, f: FormData) { 'use server'; return mutate(['/roster/mine'], async (c) => { await cancelSwap(c, field(f, 'id')); return 'Request withdrawn.'; }); }

export default async function MyShifts() {
  return page(async (p) => {
    p.requireFeature('attendance');
    need(p.ctx, 'roster:swap');
    const [shifts, swaps, mates, theirs] = await Promise.all([myShifts(p.ctx), mySwaps(p.ctx), colleagues(p.ctx), colleagueShifts(p.ctx)]);
    const incoming = swaps.filter((s: any) => !s.mine && s.status === 'awaiting_colleague');
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">My shifts</h1>
        {incoming.length > 0 && <section className="card !border-accent/60"><h2 className="font-semibold">Colleagues asking you to cover or exchange</h2><ul className="mt-2 divide-y divide-line">{incoming.map((s: any) => (
          <li key={s.id} className="py-3"><p className="text-sm"><strong>{s.requester}</strong> · {s.d} · {s.shift} ({s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}){s.counter_date && <strong> ⇄ your {s.counter_date} {s.counter_shift}</strong>}{s.reason && <span className="text-muted"> — {s.reason}</span>}</p>
            <ActionForm action={reply as any} submit="" className="!mt-1" buttons={[{ label: 'I can cover it', value: 'yes' }, { label: 'Decline', value: 'no', tone: 'ghost' }]}><input type="hidden" name="id" value={s.id} /></ActionForm></li>))}</ul></section>}
        <section className="card"><h2 className="font-semibold">Upcoming shifts</h2>
          {shifts.length === 0 ? <div className="mt-2"><Empty title="No upcoming shifts" text="When the roster is published, your shifts show here." /></div> : <ul className="mt-2 divide-y divide-line">{shifts.map((s: any) => (
            <li key={s.id} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm"><strong>{s.d}</strong> · {s.name} ({s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)})</p>{s.swap_status && <span className="badge">{SWAP_LABEL[s.swap_status]}</span>}</div>
              {!s.swap_status && mates.length > 0 && <details className="mt-2"><summary className="cursor-pointer text-sm underline">Ask a colleague to cover</summary>
                <ActionForm action={ask as any} submit="Send request" className="mt-2"><input type="hidden" name="entry" value={s.id} /><div className="grid gap-x-3 sm:grid-cols-2"><Select label="Colleague to cover (leave empty if exchanging)" name="target" options={mates.map((m: any) => ({ value: m.id, label: m.full_name }))} /><Select label="…or exchange for one of their shifts" name="counter" options={theirs.map((t: any) => ({ value: t.id, label: `${t.full_name}: ${t.d} ${t.name} (${t.start_time.slice(0, 5)}–${t.end_time.slice(0, 5)})` }))} /><Field label="Reason (optional)" name="reason" /></div></ActionForm></details>}</li>))}</ul>}</section>
        <section className="card"><h2 className="font-semibold">My requests</h2>
          {swaps.length === 0 ? <p className="mt-2 text-sm text-muted">No requests yet.</p> : <ul className="mt-2 divide-y divide-line text-sm">{swaps.map((s: any) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{s.d} · {s.shift} · {s.counter_date ? (s.mine ? `exchange with ${s.target} (you take ${s.counter_date} ${s.counter_shift})` : `exchange with ${s.requester} (you give ${s.counter_date} ${s.counter_shift})`) : (s.mine ? `${s.target} to cover` : `covering for ${s.requester}`)}{s.decision_note && s.status !== 'approved' ? ` (${s.decision_note})` : ''}</span><span className="flex items-center gap-2"><span className="badge">{SWAP_LABEL[s.status]}</span>
              {s.mine && ['awaiting_colleague', 'awaiting_manager'].includes(s.status) && <ActionForm action={withdraw as any} submit="Withdraw" tone="ghost" className="!mt-0"><input type="hidden" name="id" value={s.id} /></ActionForm>}</span></li>))}</ul>}</section>
      </div>
    );
  });
}
