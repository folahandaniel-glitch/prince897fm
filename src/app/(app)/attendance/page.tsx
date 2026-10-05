import { page, mutate, field } from '@/server/session';
import { clockIn, clockOut, submitException, todayView, type ClockResult } from '@/server/attendance';
import { ClockPanel } from '@/components/clock';
import { ActionForm, Field } from '@/components/forms';

export const metadata = { title: 'Attendance' };
export const dynamic = 'force-dynamic';

type Payload = { lat?: number | null; lng?: number | null; accuracyM?: number | null; deviceId: string; key: string; workplaceId?: string };
const toState = (r: ClockResult) => (r.ok ? { ok: r.message } : { error: r.message });

async function onIn(p: Payload) {
  'use server';
  let out: ClockResult = { ok: false, code: 'error', message: 'Something went wrong.' };
  const res = await mutate(['/attendance', '/dashboard'], async (c) => { out = await clockIn(c, { lat: p.lat, lng: p.lng, accuracyM: p.accuracyM, deviceId: p.deviceId, idempotencyKey: p.key, workplaceId: p.workplaceId }); });
  return res?.error ? { error: res.error } : toState(out);
}
async function onOut(p: Payload) {
  'use server';
  let out: ClockResult = { ok: false, code: 'error', message: 'Something went wrong.' };
  const res = await mutate(['/attendance', '/dashboard'], async (c) => { out = await clockOut(c, { lat: p.lat, lng: p.lng, accuracyM: p.accuracyM }); });
  return res?.error ? { error: res.error } : toState(out);
}
async function report(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/attendance'], async (c) => {
    await submitException(c, { kind: field(f, 'kind'), note: field(f, 'note'), workDate: field(f, 'workDate') || undefined, sessionId: field(f, 'sessionId') || undefined, requestedTime: field(f, 'requestedTime') || undefined });
    return 'Submitted for review. It is not approved until a supervisor decides.';
  });
}

const fmt = (d: any, tz: string) => (d ? new Date(d).toLocaleTimeString('en-NG', { timeZone: tz, hour: '2-digit', minute: '2-digit' }) : '—');
const BADGE: Record<string, string> = { accepted: 'On record', accepted_flagged: 'On record · note', requires_review: 'Awaiting review' };

export default async function AttendancePage() {
  return page(async (p) => {
    const t = await todayView(p.ctx);
    const clockedIn = !!t.open;
    const canClockIn = !!t.shift && t.workplaces.length > 0 && t.timing?.status !== 'too_early';
    const missed = t.history.filter((h: any) => h.status === 'missed_clock_out');
    let hint = '';
    if (clockedIn) hint = `Clocked in since ${fmt(t.open.clock_in_at, t.tz)}.`;
    else if (!t.shift) hint = 'No shift is scheduled for you right now.';
    else if (t.workplaces.length === 0) hint = 'No workplace is assigned to you yet. Ask HR.';
    else if (t.timing?.status === 'too_early') hint = `Clock-in opens ${t.timing.minutesUntilWindow} minute(s) before ${t.shift.start}.`;
    return (
      <div className="mx-auto max-w-xl space-y-5">
        <header><h1 className="text-2xl font-bold">Attendance</h1>
          <p className="text-sm text-muted">{t.local.date} · {t.employee.full_name}</p></header>

        <section className="card space-y-3" aria-label="Today">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-muted">Today&apos;s shift</dt><dd className="font-semibold">{t.shift ? `${t.shift.name} · ${t.shift.start}–${t.shift.end}` : 'None scheduled'}</dd></div>
            <div><dt className="text-muted">Workplace</dt><dd className="font-semibold">{t.workplaces.map((w) => w.name).join(', ') || '—'}</dd></div>
            <div><dt className="text-muted">Status</dt><dd className="font-semibold">{clockedIn ? 'Clocked in' : 'Not clocked in'}</dd></div>
            <div><dt className="text-muted">Roster</dt><dd className="font-semibold">{t.shift ? (t.rostered ? 'Rostered' : 'Not rostered') : '—'}</dd></div>
          </dl>
          {hint && <p className="text-sm text-muted">{hint}</p>}
          <ClockPanel clockedIn={clockedIn} canClockIn={canClockIn} workplaces={t.workplaces.map((w) => ({ id: w.id, name: w.name }))} onIn={onIn} onOut={onOut} />
          <p className="text-xs text-muted">Your location is read once when you tap the button. It is never tracked in the background.</p>
        </section>

        <section className="card" aria-labelledby="rep">
          <h2 id="rep" className="font-semibold">Report late, absent, remote or a problem</h2>
          <p className="text-sm text-muted">A supervisor reviews this. Sending a request does not approve it.</p>
          <ActionForm action={report as any} submit="Send for review" className="mt-3">
            <div className="mb-3"><label className="label" htmlFor="kind">What happened?</label>
              <select id="kind" name="kind" className="input" required defaultValue="late">
                <option value="late">I will be / was late</option><option value="absent">I cannot come today</option><option value="remote">I am working remotely</option>
                <option value="field">I am on field assignment</option><option value="cannot_clock_in">I am unable to clock in</option>
                <option value="alt_location">I am at an approved alternative location</option><option value="missed_clock_out">I forgot to clock out</option><option value="other">Other</option></select></div>
            <Field label="Date" name="workDate" type="date" defaultValue={t.local.date} />
            {missed.length > 0 && (
              <div className="mb-3 rounded-lg border border-line p-3"><p className="text-sm font-medium">Forgot to clock out? Pick the record and when you finished.</p>
                <select name="sessionId" className="input mt-2" defaultValue=""><option value="">— not a clock-out correction —</option>
                  {missed.map((h: any) => <option key={h.id} value={h.id}>{h.work_date} · in {fmt(h.clock_in_at, t.tz)}</option>)}</select>
                <div className="mt-2"><label className="label" htmlFor="rt">Finished at</label><input id="rt" name="requestedTime" type="datetime-local" className="input" /></div></div>)}
            <div className="mb-1"><label className="label" htmlFor="note">Explanation</label><textarea id="note" name="note" required minLength={5} rows={3} className="input py-2" /></div>
          </ActionForm>
          {t.exceptions.length > 0 && (
            <ul className="mt-4 divide-y divide-line text-sm">{t.exceptions.map((x: any) => (
              <li key={x.id} className="py-2"><span className="font-medium">{x.work_date} · {x.kind.replace(/_/g, ' ')}</span> <span className="badge">{x.status.replace('_', ' ')}</span>
                {x.decision_note && <p className="text-muted">{x.decision_note}</p>}</li>))}</ul>)}
        </section>

        <section className="card" aria-labelledby="hist">
          <h2 id="hist" className="font-semibold">Recent attendance</h2>
          {t.history.length === 0 ? <p className="mt-2 text-sm text-muted">No attendance yet. Your first clock-in will appear here.</p> : (
            <ul className="mt-2 divide-y divide-line text-sm">{t.history.map((h: any) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><span className="font-medium">{h.work_date}</span> · {h.shift_name ?? 'Unrostered'} · {fmt(h.clock_in_at, t.tz)}–{h.clock_out_at ? fmt(h.clock_out_at, t.tz) : (h.status === 'missed_clock_out' ? 'no clock-out' : 'open')}</span>
                <span className="flex gap-1">{h.late_minutes > 0 && <span className="badge">{h.late_minutes} min late</span>}<span className="badge">{BADGE[h.clock_in_result] ?? h.clock_in_result}</span></span></li>))}</ul>)}
        </section>
      </div>
    );
  });
}
