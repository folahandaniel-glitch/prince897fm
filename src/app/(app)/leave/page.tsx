import { page, mutate, field } from '@/server/session';
import { leaveOverview, requestLeave } from '@/server/attendance';
import { ActionForm, Field, Select } from '@/components/forms';

export const metadata = { title: 'Leave' };
export const dynamic = 'force-dynamic';

async function request(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/leave'], async (c) => { await requestLeave(c, { typeId: field(f, 'typeId'), start: field(f, 'start'), end: field(f, 'end'), reason: field(f, 'reason') }); return 'Request sent for approval.'; });
}

export default async function LeavePage() {
  return page(async (p) => {
    const o = await leaveOverview(p.ctx);
    const today = new Date().toISOString().slice(0, 10);
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-2xl font-bold">Leave</h1>
        <section aria-label="Balances" className="grid gap-3 sm:grid-cols-2">{o.balances.map((b) => (
          <div key={b.id} className="card !p-4"><p className="text-sm text-muted">{b.name}</p>
            <p className="text-2xl font-bold">{b.remaining === null ? 'Not capped' : `${b.remaining} days left`}</p>
            <p className="text-xs text-muted">{b.entitlement > 0 ? `of ${b.entitlement} · ` : ''}{b.used} used · {b.pending} pending</p></div>))}</section>

        <section className="card" aria-labelledby="req"><h2 id="req" className="font-semibold">Request leave</h2>
          <ActionForm action={request as any} submit="Send request" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-3">
            <Select label="Type" name="typeId" required allowEmpty={false} options={o.balances.map((b) => ({ value: b.id, label: b.name }))} />
            <Field label="First day" name="start" type="date" required defaultValue={today} /><Field label="Last day" name="end" type="date" required defaultValue={today} /></div>
            <Field label="Reason (optional)" name="reason" /><p className="text-xs text-muted">Weekends are not counted. A supervisor approves or rejects; your rostered shifts on approved days are released automatically.</p></ActionForm></section>

        <section className="card" aria-labelledby="my"><h2 id="my" className="font-semibold">My requests</h2>
          {o.requests.length === 0 ? <p className="mt-2 text-sm text-muted">No leave requests yet.</p> : (
            <ul className="mt-2 divide-y divide-line text-sm">{o.requests.map((r: any) => (
              <li key={r.id} className="py-2"><span className="font-medium">{r.type}</span> · {r.s} → {r.e} · {Number(r.days)} day(s) <span className="badge">{r.status}</span>{r.decision_note && <p className="text-muted">{r.decision_note}</p>}</li>))}</ul>)}</section>
      </div>
    );
  });
}
