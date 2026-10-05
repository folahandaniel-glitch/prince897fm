import { beforeAll, describe, expect, it } from 'vitest';
import { privileged, withTenant } from '../src/server/db';
import { seedOrganization, TEMPLATES } from '../src/server/seed';
import { runAs } from '../src/server/ctx';
import { ForbiddenError } from '../src/domain/policy';
import { localParts, addDays } from '../src/domain/attendance';
import {
  addShift, addWorkplace, assignRoster, clockIn, clockOut, leaveOverview, listShifts, pendingExceptions, pendingLeave, requestLeave,
  reviewException, reviewLeave, submitException, teamBoard, todayView, weekRoster,
} from '../src/server/attendance';

const ids: Record<string, string> = {};
const HQ = { lat: 7.3990014, lng: 3.9411920 }; // Glass House, Ibadan
const NEAR = { lat: HQ.lat + 0.0003, lng: HQ.lng, accuracyM: 15 };   // ~33 m
const FAR = { lat: HQ.lat + 0.05, lng: HQ.lng, accuracyM: 15 };      // ~5.5 km
const hhmm = (m: number) => { const x = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

async function user(email: string) {
  return (await (await privileged()).query<any>('select u.id from users u join organizations o on o.id=u.org_id where o.slug=$1 and u.email=$2', ['prince897', email]))[0].id as string;
}
const as = <T>(u: string, fn: Parameters<typeof runAs<T>>[2]) => runAs(ids.org, u, fn, { ip: '10.1.1.1' });

let admin: string, hr: string, presenter: string, chairman: string;

beforeAll(async () => {
  const lines: string[] = [];
  for (const t of TEMPLATES) await seedOrganization(t, lines);
  ids.org = (await (await privileged()).query<any>(`select id from organizations where slug = 'prince897'`))[0].id;
  ids.church = (await (await privileged()).query<any>(`select id from organizations where slug = 'gracechapel'`))[0].id;
  [admin, hr, presenter, chairman] = await Promise.all(['admin', 'hr', 'presenter', 'chairman'].map((n) => user(`${n}@prince897.example`)));
  // A shift that is "open" right now in the workplace timezone, so tests are independent of the clock.
  const now = localParts(new Date(), 'Africa/Lagos').minutes;
  await as(hr, (c) => addShift(c, { name: 'Test now', code: 'TNOW', start: hhmm(Math.max(0, now - 5)), end: hhmm(now + 480) }));
  // Remove the seeded shifts so only the test shift can match.
  await (await privileged()).query(`update shifts set archived_at = now() where code <> 'TNOW'`);
});

describe('clock-in verification (spec scenarios)', () => {
  it('1. inside the geofence: accepted', async () => {
    const r = await as(presenter, (c) => clockIn(c, { ...NEAR, deviceId: 'phone-A' }));
    expect(r).toMatchObject({ ok: true, result: expect.stringMatching(/accepted/) });
  });

  it('6. clocking in twice never creates duplicate attendance', async () => {
    const again = await as(presenter, (c) => clockIn(c, { ...NEAR, deviceId: 'phone-A' }));
    expect(again).toMatchObject({ ok: false, code: 'already_clocked_in' });
    const n = await withTenant(ids.org, (q) => q.query<any>(`select count(*)::int c from attendance_sessions where status = 'open'`));
    expect(n[0].c).toBe(1);
  });

  it('5. nobody can clock in for someone else: the employee is always the signed-in user', async () => {
    // The API has no employee parameter. Prove the session belongs to the caller's own employee only.
    const row = await withTenant(ids.org, (q) => q.query<any>(`select e.user_id from attendance_sessions s join employees e on e.id = s.employee_id`));
    expect(row.map((r) => r.user_id)).toEqual([presenter]);
  });

  it('clock-out closes the session', async () => {
    expect(await as(presenter, (c) => clockOut(c, {}))).toMatchObject({ ok: true });
    expect(await as(presenter, (c) => clockOut(c, {}))).toMatchObject({ ok: false, code: 'not_clocked_in' });
  });

  it('2. outside the geofence is blocked with an explanation, and the attempt is kept as evidence', async () => {
    // a different employee (HR) so there is no existing session for today's shift
    const r = await as(hr, (c) => clockIn(c, { ...FAR, deviceId: 'phone-B' }));
    expect(r).toMatchObject({ ok: false, code: 'outside' });
    expect((r as any).message).toMatch(/request an exception/);
    const a = await withTenant(ids.org, (q) => q.query<any>(`select result from attendance_attempts where result = 'blocked_outside'`));
    expect(a.length).toBe(1);
  });

  it('10. no location available: accepted for review, not silently failed', async () => {
    const r = await as(hr, (c) => clockIn(c, { deviceId: 'phone-B' }));
    expect(r).toMatchObject({ ok: true, result: 'requires_review' });
    expect((r as any).flags).toContain('location_unavailable');
  });

  it('12. a device shared by two employees raises a review flag, never a penalty', async () => {
    const r = await as(chairman, (c) => clockIn(c, { ...NEAR, deviceId: 'phone-B' }));
    expect(r).toMatchObject({ ok: true, result: 'requires_review' });
    expect((r as any).flags).toContain('shared_device');
  });

  it('7. a forgotten clock-out is flagged and can be corrected through review', async () => {
    const p = await privileged();
    // Pretend the chairman never clocked out: age the session by 20 hours (previous workday).
    await p.query(`update attendance_sessions set clock_in_at = now() - interval '20 hours', work_date = work_date - 1 where employee_id = (select id from employees where user_id = $1)`, [chairman]);
    const r = await as(chairman, (c) => clockIn(c, { ...NEAR, deviceId: 'phone-C' }));
    expect(r).toMatchObject({ ok: true });
    const missed = await withTenant(ids.org, (q) => q.query<any>(`select id from attendance_sessions where status = 'missed_clock_out'`));
    expect(missed.length).toBe(1);
    const requested = new Date(Date.now() - 12 * 3600_000).toISOString();
    await as(chairman, (c) => submitException(c, { kind: 'missed_clock_out', note: 'Forgot to clock out after the evening bulletin', sessionId: missed[0].id, requestedTime: requested }));
    const [x] = await as(hr, (c) => pendingExceptions(c));
    await as(hr, (c) => reviewException(c, x.id, true, 'Confirmed with supervisor'));
    const fixed = await withTenant(ids.org, (q) => q.query<any>(`select status, clock_out_at from attendance_sessions where id = $1`, [missed[0].id]));
    expect(fixed[0].status).toBe('corrected');
    const aud = await withTenant(ids.org, (q) => q.query<any>(`select before, after from audit_events where action = 'attendance.corrected'`));
    expect(aud.length).toBe(1);
    expect(aud[0].before).toBeTruthy();
  });
});

describe('explanations are not approvals, and reviewers cannot review themselves', () => {
  it('8. lateness explanation sits in pending review; the employee cannot approve it', async () => {
    await as(presenter, (c) => submitException(c, { kind: 'late', note: 'Heavy traffic on the expressway' }));
    await expect(as(presenter, (c) => pendingExceptions(c))).rejects.toBeInstanceOf(ForbiddenError);
    const pending = await as(hr, (c) => pendingExceptions(c));
    expect(pending.some((p) => p.kind === 'late' && p.status === 'pending_review')).toBe(true);
    await expect(as(presenter, (c) => reviewException(c, pending.find((p) => p.kind === 'late')!.id, true, 'self'))).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('a reviewer cannot approve their own request (separation of duties)', async () => {
    await as(hr, (c) => submitException(c, { kind: 'remote', note: 'Working from the field today' }));
    const mine = (await as(hr, (c) => pendingExceptions(c))).find((p) => p.kind === 'remote')!;
    await expect(as(hr, (c) => reviewException(c, mine.id, true, 'ok'))).rejects.toThrow(/own attendance request/);
  });
});

describe('workplaces and configuration', () => {
  it('validates coordinates and radius', async () => {
    await expect(as(admin, (c) => addWorkplace(c, { name: 'Bad site', kind: 'office', latitude: 120, longitude: 3 }))).rejects.toThrow(/out of range/);
    await expect(as(admin, (c) => addWorkplace(c, { name: 'Bad site', kind: 'office', latitude: 6, longitude: 3, radiusM: 5 }))).rejects.toThrow(/Radius/);
    await as(admin, (c) => addWorkplace(c, { name: 'Remote desk', kind: 'remote' }));
  });
  it('employees cannot manage shifts', async () => {
    await expect(as(presenter, (c) => addShift(c, { name: 'x', code: 'X', start: '01:00', end: '09:00' }))).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('supports shifts that cross midnight', async () => {
    await as(admin, (c) => addShift(c, { name: 'Late night', code: 'LN', start: '22:00', end: '06:00' }));
    expect((await withTenant(ids.org, (q) => listShifts(q))).some((s) => s.code === 'LN' && s.start === '22:00' && s.end === '06:00')).toBe(true);
  });
});

describe('rosters and leave', () => {
  const monday = (() => { let d = new Date().toISOString().slice(0, 10); while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1); return addDays(d, 7); })();
  let presenterEmp = '';
  it('detects conflicts and publishes valid rosters', async () => {
    presenterEmp = (await withTenant(ids.org, (q) => q.query<any>('select id from employees where user_id = $1', [presenter])))[0].id;
    const shifts = await withTenant(ids.org, (q) => listShifts(q));
    const ln = shifts.find((s) => s.code === 'LN')!, tnow = shifts.find((s) => s.code === 'TNOW')!;
    const ok = await as(hr, (c) => assignRoster(c, { employeeId: presenterEmp, shiftId: ln.id, dates: [monday, addDays(monday, 1)] }));
    expect(ok.created.length).toBe(2);
    const dup = await as(hr, (c) => assignRoster(c, { employeeId: presenterEmp, shiftId: ln.id, dates: [monday] }));
    expect(dup.blocked[0]).toMatch(/Overlaps/);
    void tnow; // whether the clock-relative test shift clashes depends on the hour, so it is not asserted here
    const grid = await as(hr, (c) => weekRoster(c, monday));
    expect(grid.entries.length).toBeGreaterThanOrEqual(2);
    await expect(as(presenter, (c) => weekRoster(c, monday))).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('leave: balance check, approval by another person, roster released', async () => {
    const types = await as(presenter, (c) => leaveOverview(c));
    const annual = types.balances.find((b) => b.name === 'Annual leave')!;
    expect(annual.remaining).toBe(20);
    await expect(as(presenter, (c) => requestLeave(c, { typeId: annual.id, start: monday, end: addDays(monday, 40) }))).rejects.toThrow(/Not enough/);
    await as(presenter, (c) => requestLeave(c, { typeId: annual.id, start: monday, end: addDays(monday, 1), reason: 'Family event' }));
    await expect(as(presenter, (c) => requestLeave(c, { typeId: annual.id, start: monday, end: monday }))).rejects.toThrow(/already/);
    const [req] = await as(hr, (c) => pendingLeave(c));
    expect(req.rostered).toBe(2);
    await expect(as(presenter, (c) => reviewLeave(c, req.id, true, ''))).rejects.toBeInstanceOf(ForbiddenError);
    const note = await as(hr, (c) => reviewLeave(c, req.id, true, 'Enjoy'));
    expect(note).toMatch(/2 rostered shift/);
    const after = await as(presenter, (c) => leaveOverview(c));
    expect(after.balances.find((b) => b.name === 'Annual leave')!.used).toBe(2);
    // and the roster now refuses leave days
    const ln = (await withTenant(ids.org, (q) => listShifts(q))).find((s) => s.code === 'LN')!;
    const blocked = await as(hr, (c) => assignRoster(c, { employeeId: presenterEmp, shiftId: ln.id, dates: [monday] }));
    expect(blocked.blocked[0]).toMatch(/leave/);
  });
});

describe('visibility and isolation', () => {
  it('team board is limited to people with attendance permission and shows today\'s status', async () => {
    const b = await as(hr, (c) => teamBoard(c));
    expect(b.summary.late + b.summary.present).toBeGreaterThan(0);
    await expect(as(presenter, (c) => teamBoard(c))).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('another organisation sees none of it', async () => {
    const rows = await withTenant(ids.church, (q) => q.query<any>('select count(*)::int c from attendance_sessions'));
    expect(rows[0].c).toBe(0);
    const attempts = await withTenant(ids.church, (q) => q.query<any>('select count(*)::int c from attendance_attempts'));
    expect(attempts[0].c).toBe(0);
  });
  it('attempts are append-only for the application role', async () => {
    await expect(withTenant(ids.org, (q) => q.query(`delete from attendance_attempts`))).rejects.toThrow();
  });
  it('today view reports the employee\'s own context only', async () => {
    const t = await as(presenter, (c) => todayView(c));
    expect(t.employee.full_name).toMatch(/Presenter/);
    expect(t.workplaces.length).toBeGreaterThan(0);
  });
});
