import crypto from 'node:crypto';
import {
  addDays, classifyClockIn, countDays, detectRosterConflicts, evaluateLocation, impossibleTravel, localParts, toMin, workDateFor,
  type ShiftDef,
} from '../domain/attendance';
import { can } from '../domain/policy';
import { audit } from './audit';
import { need, today, UserError, type Ctx } from './ctx';
import { notify } from './hr';
import type { Q } from './db';

const STALE_OPEN_HOURS = 18;
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s: string) => dateRe.test(s) && !Number.isNaN(Date.parse(s));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export interface ShiftRow { id: string; name: string; code: string; start: string; end: string; graceMin: number; earlyMin: number }
const shiftDef = (s: ShiftRow): ShiftDef => ({ startMin: toMin(s.start), endMin: toMin(s.end), graceMin: s.graceMin, earlyWindowMin: s.earlyMin });
const mapShift = (r: any): ShiftRow => ({ id: r.id, name: r.name, code: r.code, start: String(r.start_time).slice(0, 5), end: String(r.end_time).slice(0, 5), graceMin: r.grace_minutes, earlyMin: r.early_window_minutes });

async function orgTz(q: Q, orgId: string) {
  return (await q.query<{ timezone: string }>('select timezone from organizations where id = $1', [orgId]))[0]?.timezone ?? 'Africa/Lagos';
}

export async function myEmployee(c: Ctx) {
  const e = (await c.q.query<any>(
    `select e.id, e.full_name, e.employee_no, a.department_id, a.branch_id from employees e
       left join assignments a on a.employee_id = e.id and a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)
      where e.user_id = $1`, [c.userId]))[0];
  if (!e) throw new UserError('Your login is not linked to an employee record. Ask HR to link it.');
  return e as { id: string; full_name: string; employee_no: string; department_id: string | null; branch_id: string | null };
}

// ---- Configuration: shifts and workplaces -------------------------------------------------------------------------------
export async function listShifts(q: Q) {
  return (await q.query<any>('select * from shifts where archived_at is null order by start_time, name')).map(mapShift);
}

export async function addShift(c: Ctx, i: { name: string; code: string; start: string; end: string; graceMin?: number; earlyMin?: number }) {
  need(c, 'attendance:manage');
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!i.name.trim() || !i.code.trim()) throw new UserError('Enter a shift name and code.');
  if (!time.test(i.start) || !time.test(i.end)) throw new UserError('Enter start and end times as HH:MM (24-hour).');
  if (i.start === i.end) throw new UserError('Start and end times cannot be identical.');
  const dup = await c.q.query('select 1 from shifts where lower(code) = lower($1) and archived_at is null', [i.code.trim()]);
  if (dup[0]) throw new UserError(`A shift with code "${i.code.trim()}" already exists.`);
  const r = await c.q.query<{ id: string }>(
    `insert into shifts (org_id, name, code, start_time, end_time, grace_minutes, early_window_minutes) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [c.orgId, i.name.trim(), i.code.trim().toUpperCase(), i.start, i.end, i.graceMin ?? 10, i.earlyMin ?? 60]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'shift.created', entity: 'shift', entityId: r[0].id, after: i, ip: c.ip, userAgent: c.userAgent });
}

export async function listWorkplaces(q: Q) {
  return (await q.query<any>('select * from workplaces order by active desc, name')).map((w) => ({ ...w, latitude: num(w.latitude), longitude: num(w.longitude) }));
}

export interface WorkplaceInput { name: string; kind: string; address?: string; latitude?: number | null; longitude?: number | null; radiusM?: number; validFrom?: string; validTo?: string }

export async function addWorkplace(c: Ctx, i: WorkplaceInput) {
  need(c, 'attendance:manage');
  if (i.name.trim().length < 2) throw new UserError('Enter a workplace name.');
  const needsCoords = !['remote', 'field'].includes(i.kind);
  if (needsCoords) {
    if (i.latitude == null || i.longitude == null || !Number.isFinite(i.latitude) || !Number.isFinite(i.longitude)) throw new UserError('Latitude and longitude are required for a physical workplace.');
    if (Math.abs(i.latitude) > 90 || Math.abs(i.longitude) > 180) throw new UserError('Coordinates are out of range.');
  }
  const radius = i.radiusM ?? 150;
  if (radius < 20 || radius > 5000) throw new UserError('Radius must be between 20 and 5000 metres.');
  const r = await c.q.query<{ id: string }>(
    `insert into workplaces (org_id, name, kind, address, latitude, longitude, radius_m, location_required, valid_from, valid_to) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [c.orgId, i.name.trim(), i.kind, i.address ?? null, i.latitude ?? null, i.longitude ?? null, radius, needsCoords, i.validFrom || null, i.validTo || null]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'workplace.created', entity: 'workplace', entityId: r[0].id, after: i, ip: c.ip, userAgent: c.userAgent });
}

export async function assignWorkplace(c: Ctx, i: { employeeId: string; workplaceId: string; kind: string; validFrom?: string; validTo?: string }) {
  need(c, 'attendance:manage');
  const emp = (await c.q.query('select id from employees where id = $1', [i.employeeId]))[0];
  const wp = (await c.q.query('select id from workplaces where id = $1 and active', [i.workplaceId]))[0];
  if (!emp || !wp) throw new UserError('Unknown employee or workplace.');
  await c.q.query(`insert into workplace_assignments (org_id, employee_id, workplace_id, kind, valid_from, valid_to, created_by) values ($1,$2,$3,$4,coalesce($5::date, current_date),$6,$7)`,
    [c.orgId, i.employeeId, i.workplaceId, i.kind, i.validFrom || null, i.validTo || null, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'workplace.assigned', entity: 'employee', entityId: i.employeeId, after: i, ip: c.ip, userAgent: c.userAgent });
}

/** Workplaces an employee may clock in at today: explicit assignments plus active workplaces of their branch. */
async function authorisedWorkplaces(q: Q, employeeId: string, branchId: string | null, date: string) {
  const rows = await q.query<any>(
    `select distinct w.* from workplaces w
      where w.active and (w.valid_from is null or w.valid_from <= $2::date) and (w.valid_to is null or w.valid_to >= $2::date)
        and (w.id in (select workplace_id from workplace_assignments where employee_id = $1 and valid_from <= $2::date and (valid_to is null or valid_to >= $2::date))
             or ($3::uuid is not null and w.branch_id = $3::uuid and w.kind in ('headquarters','branch','office')))`,
    [employeeId, date, branchId]);
  return rows.map((w) => ({ ...w, latitude: num(w.latitude), longitude: num(w.longitude) }));
}

// ---- Today's context for the employee ---------------------------------------------------------------------------------------
async function resolveShift(q: Q, emp: { id: string; department_id: string | null }, now: Date, tz: string) {
  const local = localParts(now, tz);
  const rostered = (await q.query<any>(
    `select s.*, r.work_date::text as wd, r.workplace_id as r_workplace from roster_entries r join shifts s on s.id = r.shift_id
      where r.employee_id = $1 and r.status = 'published' and r.superseded_at is null and r.work_date between $2::date and $3::date`,
    [emp.id, addDays(local.date, -1), local.date]));
  let best: { shift: ShiftRow; wd: string; rostered: boolean; workplaceId: string | null; score: number } | null = null;
  for (const r of rostered) {
    const sh = mapShift(r);
    const def = shiftDef(sh);
    if (workDateFor(local, def) !== r.wd) continue;
    const t = classifyClockIn(local.minutes, def);
    if (t.status === 'after_shift' && rostered.length > 1) continue;
    const score = Math.abs(((local.minutes - def.startMin + 720 + 1440) % 1440) - 720);
    if (!best || score < best.score) best = { shift: sh, wd: r.wd, rostered: true, workplaceId: r.r_workplace, score };
  }
  if (best) return best;
  // Unrostered fallback: a shift that applies to the employee's department and whose window is open now.
  const shifts = (await q.query<any>('select * from shifts where archived_at is null and (department_ids is null or $1::uuid = any(department_ids))', [emp.department_id])).map(mapShift);
  for (const sh of shifts) {
    const def = shiftDef(sh);
    const t = classifyClockIn(local.minutes, def);
    if (t.status === 'on_time' || t.status === 'late') return { shift: sh, wd: workDateFor(local, def), rostered: false, workplaceId: null, score: 0 };
  }
  return null;
}

export async function todayView(c: Ctx) {
  need(c, 'attendance:clock');
  const emp = await myEmployee(c);
  const tz = await orgTz(c.q, c.orgId);
  const now = new Date();
  const local = localParts(now, tz);
  const open = (await c.q.query<any>(`select s.*, sh.name as shift_name from attendance_sessions s left join shifts sh on sh.id = s.shift_id where s.employee_id = $1 and s.status = 'open'`, [emp.id]))[0] ?? null;
  const resolved = await resolveShift(c.q, emp, now, tz);
  const wps = await authorisedWorkplaces(c.q, emp.id, emp.branch_id, local.date);
  const history = await c.q.query<any>(
    `select s.id, s.work_date::text as work_date, s.clock_in_at, s.clock_out_at, s.status, s.clock_in_result, s.flags, s.late_minutes, sh.name as shift_name, w.name as workplace
       from attendance_sessions s left join shifts sh on sh.id = s.shift_id left join workplaces w on w.id = s.workplace_id where s.employee_id = $1 order by s.clock_in_at desc limit 14`, [emp.id]);
  const exceptions = await c.q.query<any>(`select id, work_date::text as work_date, kind, note, status, decision_note from attendance_exceptions where employee_id = $1 order by created_at desc limit 8`, [emp.id]);
  return {
    employee: emp, tz, local, open, history, exceptions,
    shift: resolved?.shift ?? null, rostered: resolved?.rostered ?? false,
    timing: resolved ? classifyClockIn(local.minutes, shiftDef(resolved.shift)) : null,
    workplaces: wps.map((w) => ({ id: w.id, name: w.name, kind: w.kind, radiusM: w.radius_m, locationRequired: w.location_required })),
  };
}

// ---- Clock in / out -----------------------------------------------------------------------------------------------------------------
export interface ClockInput { lat?: number | null; lng?: number | null; accuracyM?: number | null; workplaceId?: string | null; deviceId?: string; idempotencyKey?: string }
export type ClockResult =
  | { ok: true; message: string; result: string; flags: string[]; duplicate?: boolean }
  | { ok: false; code: string; message: string };

const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);

export async function clockIn(c: Ctx, input: ClockInput): Promise<ClockResult> {
  need(c, 'attendance:clock');
  const emp = await myEmployee(c); // never taken from the request: nobody can clock in for someone else
  await c.q.query('select id from employees where id = $1 for update', [emp.id]); // serialise this employee's attempts
  const tz = await orgTz(c.q, c.orgId);
  const now = new Date();
  const local = localParts(now, tz);
  const device = input.deviceId ? hash(`${c.orgId}:${input.deviceId}`) : null;
  const attempt = async (result: string, reason: string | null, extra: { wp?: string | null; dist?: number | null } = {}) =>
    c.q.query(`insert into attendance_attempts (org_id, employee_id, action, result, reason, lat, lng, accuracy_m, distance_m, workplace_id, device_hash, ip) values ($1,$2,'clock_in',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [c.orgId, emp.id, result, reason, input.lat ?? null, input.lng ?? null, input.accuracyM != null ? Math.round(input.accuracyM) : null, extra.dist ?? null, extra.wp ?? null, device, c.ip ?? null]);

  if (input.idempotencyKey) {
    const dup = (await c.q.query<any>('select clock_in_result, flags from attendance_sessions where employee_id = $1 and idempotency_key = $2', [emp.id, input.idempotencyKey]))[0];
    if (dup) return { ok: true, duplicate: true, message: 'You are already clocked in.', result: dup.clock_in_result, flags: dup.flags };
  }

  const open = (await c.q.query<any>(`select id, clock_in_at from attendance_sessions where employee_id = $1 and status = 'open'`, [emp.id]))[0];
  if (open) {
    if (now.getTime() - new Date(open.clock_in_at).getTime() > STALE_OPEN_HOURS * 3_600_000) {
      await c.q.query(`update attendance_sessions set status = 'missed_clock_out' where id = $1`, [open.id]);
      await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'attendance.missed_clock_out_flagged', entity: 'attendance_session', entityId: open.id });
    } else {
      await attempt('duplicate', 'already_open');
      return { ok: false, code: 'already_clocked_in', message: `You are already clocked in (since ${new Date(open.clock_in_at).toLocaleTimeString('en-NG', { timeZone: tz, hour: '2-digit', minute: '2-digit' })}). Clock out first.` };
    }
  }

  const resolved = await resolveShift(c.q, emp, now, tz);
  if (!resolved) {
    await attempt('blocked_no_shift', 'no_shift_window');
    return { ok: false, code: 'no_shift', message: 'No shift is scheduled for you right now. If you are working anyway, submit an attendance request below so a supervisor can review it.' };
  }
  const def = shiftDef(resolved.shift);
  const timing = classifyClockIn(local.minutes, def);
  if (timing.status === 'too_early') {
    await attempt('blocked_early', 'too_early');
    return { ok: false, code: 'too_early', message: `Clock-in opens ${timing.minutesUntilWindow} minute(s) before ${resolved.shift.start}. Please try again shortly.` };
  }

  const wps = await authorisedWorkplaces(c.q, emp.id, emp.branch_id, local.date);
  if (wps.length === 0) {
    await attempt('blocked_no_workplace', 'no_authorised_workplace');
    return { ok: false, code: 'no_workplace', message: 'You have no authorised workplace yet. Ask HR to assign one, or submit an attendance request.' };
  }
  const candidates = input.workplaceId ? wps.filter((w) => w.id === input.workplaceId) : wps;
  if (candidates.length === 0) return { ok: false, code: 'bad_workplace', message: 'That workplace is not authorised for you.' };

  const reported = input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng, accuracyM: input.accuracyM ?? null } : null;
  let chosen: { wp: any; verdict: ReturnType<typeof evaluateLocation> } | null = null;
  for (const wp of candidates) {
    if (!wp.location_required) { chosen = { wp, verdict: { status: 'inside', distanceM: null } }; if (wp.kind !== 'remote' && wp.kind !== 'field') break; continue; }
    const v = evaluateLocation(reported, { lat: wp.latitude, lng: wp.longitude, radiusM: wp.radius_m });
    if (!chosen || (v.status === 'inside' && (chosen.verdict.status !== 'inside' || !chosen.wp.location_required)) || (chosen.verdict.status === 'outside' && v.status === 'unverifiable')) chosen = { wp, verdict: v };
    if (v.status === 'inside') break;
  }
  const { wp, verdict } = chosen!;

  if (verdict.status === 'outside') {
    await attempt('blocked_outside', 'outside_geofence', { wp: wp.id, dist: verdict.distanceM });
    return { ok: false, code: 'outside', message: `You appear to be about ${verdict.distanceM} m from ${wp.name} (allowed ${wp.radius_m} m). Move closer and try again, or request an exception if you are working remotely or in the field.` };
  }

  // Advisory integrity signals: these raise review flags and never punish automatically.
  const flags: string[] = [];
  if (timing.status === 'late') flags.push('late');
  if (timing.status === 'after_shift') flags.push('after_shift');
  if (!resolved.rostered) flags.push('unrostered');
  if (verdict.status === 'unverifiable') flags.push(verdict.reason === 'low_accuracy' ? 'location_low_accuracy' : 'location_unavailable');
  if (!wp.location_required) flags.push(wp.kind === 'remote' ? 'remote' : 'field');
  if (device) {
    const shared = await c.q.query(`select 1 from attendance_attempts where device_hash = $1 and employee_id <> $2 and created_at > now() - interval '24 hours' limit 1`, [device, emp.id]);
    if (shared[0]) flags.push('shared_device');
  }
  if (reported) {
    const prev = (await c.q.query<any>(`select lat, lng, created_at from attendance_attempts where employee_id = $1 and lat is not null and created_at > now() - interval '12 hours' order by created_at desc limit 1`, [emp.id]))[0];
    if (prev && impossibleTravel({ lat: Number(prev.lat), lng: Number(prev.lng), at: new Date(prev.created_at) }, { ...reported, at: now })) flags.push('impossible_travel');
  }
  const review = ['location_unavailable', 'location_low_accuracy', 'after_shift', 'shared_device', 'impossible_travel'].some((f) => flags.includes(f));
  const result = review ? 'requires_review' : flags.some((f) => ['late', 'unrostered', 'remote', 'field'].includes(f)) ? 'accepted_flagged' : 'accepted';

  await c.q.query('savepoint clock_in_insert');
  const session = await c.q.query<{ id: string }>(
    `insert into attendance_sessions (org_id, employee_id, work_date, shift_id, workplace_id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_accuracy_m, clock_in_distance_m, clock_in_result, flags, late_minutes, device_hash, idempotency_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
    [c.orgId, emp.id, resolved.wd, resolved.shift.id, wp.id, now, input.lat ?? null, input.lng ?? null, input.accuracyM != null ? Math.round(input.accuracyM) : null,
      verdict.distanceM, result, flags, timing.lateMinutes, device, input.idempotencyKey ?? null]).catch((e) => {
      if (/attendance_one_per_shift_day|attendance_one_open|attendance_idem|duplicate key|unique/i.test(String(e?.message))) return null;
      throw e;
    });
  if (session) await c.q.query('release savepoint clock_in_insert'); else await c.q.query('rollback to savepoint clock_in_insert');
  if (!session) { await attempt('duplicate', 'unique_violation'); return { ok: false, code: 'duplicate', message: 'Attendance for this shift is already recorded.' }; }
  await attempt(result, flags.join(',') || null, { wp: wp.id, dist: verdict.distanceM });
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'attendance.clock_in', entity: 'attendance_session', entityId: session[0].id, after: { workplace: wp.name, result, flags, lateMinutes: timing.lateMinutes }, ip: c.ip, userAgent: c.userAgent });
  const msg = result === 'requires_review'
    ? 'Clocked in. A supervisor will review this entry (' + flags.filter((f) => f !== 'late').join(', ').replace(/_/g, ' ') + ').'
    : timing.status === 'late' ? `Clocked in at ${wp.name}. You are ${timing.lateMinutes} minutes after shift start. You can add an explanation below.` : `Clocked in at ${wp.name}. Have a good shift.`;
  return { ok: true, message: msg, result, flags };
}

export async function clockOut(c: Ctx, input: ClockInput): Promise<ClockResult> {
  need(c, 'attendance:clock');
  const emp = await myEmployee(c);
  await c.q.query('select id from employees where id = $1 for update', [emp.id]);
  const open = (await c.q.query<any>(`select id, workplace_id from attendance_sessions where employee_id = $1 and status = 'open'`, [emp.id]))[0];
  if (!open) return { ok: false, code: 'not_clocked_in', message: 'You are not clocked in.' };
  await c.q.query(`update attendance_sessions set clock_out_at = now(), status = 'closed', clock_out_lat = $2, clock_out_lng = $3, clock_out_accuracy_m = $4 where id = $1`,
    [open.id, input.lat ?? null, input.lng ?? null, input.accuracyM != null ? Math.round(input.accuracyM) : null]);
  await c.q.query(`insert into attendance_attempts (org_id, employee_id, action, result, lat, lng, accuracy_m, workplace_id, ip) values ($1,$2,'clock_out','accepted',$3,$4,$5,$6,$7)`,
    [c.orgId, emp.id, input.lat ?? null, input.lng ?? null, input.accuracyM != null ? Math.round(input.accuracyM) : null, open.workplace_id, c.ip ?? null]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'attendance.clock_out', entity: 'attendance_session', entityId: open.id, ip: c.ip, userAgent: c.userAgent });
  return { ok: true, message: 'Clocked out. Thank you.', result: 'closed', flags: [] };
}

// ---- Exceptions and corrections ---------------------------------------------------------------------------------------------------------
export async function submitException(c: Ctx, i: { kind: string; note: string; workDate?: string; requestedTime?: string; sessionId?: string }) {
  need(c, 'attendance:clock');
  const emp = await myEmployee(c);
  const kinds = ['late', 'absent', 'remote', 'field', 'cannot_clock_in', 'alt_location', 'missed_clock_out', 'other'];
  if (!kinds.includes(i.kind)) throw new UserError('Choose what you want to report.');
  if (i.note.trim().length < 5) throw new UserError('Please add a short explanation (at least 5 characters).');
  const date = i.workDate || today();
  if (!isDate(date)) throw new UserError('Enter a valid date.');
  if (i.sessionId) { const s = await c.q.query('select 1 from attendance_sessions where id = $1 and employee_id = $2', [i.sessionId, emp.id]); if (!s[0]) throw new UserError('Unknown attendance record.'); }
  const requested = i.requestedTime ? new Date(i.requestedTime) : null;
  if (i.kind === 'missed_clock_out' && (!requested || Number.isNaN(requested.getTime()) || !i.sessionId)) throw new UserError('For a missed clock-out, choose the record and the time you finished.');
  const r = await c.q.query<{ id: string }>(
    `insert into attendance_exceptions (org_id, employee_id, work_date, kind, note, requested_time, session_id) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [c.orgId, emp.id, date, i.kind, i.note.trim(), requested, i.sessionId ?? null]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'attendance.exception_submitted', entity: 'attendance_exception', entityId: r[0].id, after: { kind: i.kind, date }, ip: c.ip, userAgent: c.userAgent });
}

export async function pendingExceptions(c: Ctx) {
  if (!can(c.subject, 'attendance:review').allow) need(c, 'attendance:review');
  const rows = await c.q.query<any>(
    `select x.*, x.work_date::text as wd, e.full_name, e.employee_no, a.department_id, a.branch_id, d.name as department
       from attendance_exceptions x join employees e on e.id = x.employee_id
       left join assignments a on a.employee_id = e.id and a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)
       left join departments d on d.id = a.department_id
      where x.status = 'pending_review' order by x.created_at`);
  return rows.filter((r) => can(c.subject, 'attendance:review', { departmentId: r.department_id, branchId: r.branch_id }).allow);
}

export async function reviewException(c: Ctx, id: string, approve: boolean, note: string) {
  const x = (await c.q.query<any>(
    `select x.*, e.user_id as emp_user, e.id as emp_id, a.department_id, a.branch_id from attendance_exceptions x join employees e on e.id = x.employee_id
       left join assignments a on a.employee_id = e.id and a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)
      where x.id = $1 for update of x`, [id]))[0];
  if (!x || x.status !== 'pending_review') throw new UserError('This request has already been decided.');
  need(c, 'attendance:review', { departmentId: x.department_id, branchId: x.branch_id });
  const me = (await c.q.query<{ id: string }>('select id from employees where user_id = $1', [c.userId]))[0];
  if (me && me.id === x.employee_id) throw new UserError('You cannot review your own attendance request. Another reviewer must decide it.'); // separation of duties
  if (!approve && !note.trim()) throw new UserError('Give a reason for rejecting.');
  await c.q.query(`update attendance_exceptions set status = $2, decided_by = $3, decided_at = now(), decision_note = $4 where id = $1`, [id, approve ? 'approved' : 'rejected', c.userId, note.trim() || null]);
  if (approve && x.kind === 'missed_clock_out' && x.session_id && x.requested_time) {
    const s = (await c.q.query<any>('select clock_in_at, clock_out_at, status from attendance_sessions where id = $1 for update', [x.session_id]))[0];
    if (!s || new Date(x.requested_time) <= new Date(s.clock_in_at)) throw new UserError('The requested clock-out time is not after the clock-in time.');
    await c.q.query(`update attendance_sessions set clock_out_at = $2, status = 'corrected' where id = $1`, [x.session_id, x.requested_time]);
    await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'attendance.corrected', entity: 'attendance_session', entityId: x.session_id, before: { clockOut: s.clock_out_at, status: s.status }, after: { clockOut: x.requested_time, status: 'corrected' }, reason: note || 'Approved missed clock-out', ip: c.ip, userAgent: c.userAgent });
  }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: approve ? 'attendance.exception_approved' : 'attendance.exception_rejected', entity: 'attendance_exception', entityId: id, reason: note || undefined, ip: c.ip, userAgent: c.userAgent });
  if (x.emp_user) await notify(c.q, c.orgId, x.emp_user, `Your attendance request was ${approve ? 'approved' : 'rejected'}`, note || undefined, '/attendance');
}

// ---- Team board -----------------------------------------------------------------------------------------------------------------------------------
export async function teamBoard(c: Ctx, date?: string) {
  if (!can(c.subject, 'attendance:view').allow) need(c, 'attendance:review');
  const d = date && isDate(date) ? date : localParts(new Date(), await orgTz(c.q, c.orgId)).date;
  const rows = await c.q.query<any>(
    `select e.id, e.full_name, e.employee_no, dep.name as department, a.department_id, a.branch_id,
            r.shift_name, s.clock_in_at, s.clock_out_at, s.status as session_status, s.clock_in_result, s.flags, s.late_minutes, w.name as workplace
       from employees e
       left join assignments a on a.employee_id = e.id and a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= $1::date and (a.valid_to is null or a.valid_to > $1::date)
       left join departments dep on dep.id = a.department_id
       left join lateral (select sh.name as shift_name from roster_entries re join shifts sh on sh.id = re.shift_id where re.employee_id = e.id and re.work_date = $1::date and re.status = 'published' and re.superseded_at is null limit 1) r on true
       left join attendance_sessions s on s.employee_id = e.id and s.work_date = $1::date
       left join workplaces w on w.id = s.workplace_id
      where e.status in ('active','on_leave') order by dep.name nulls last, e.full_name`, [d]);
  const visible = rows.filter((r) => can(c.subject, 'attendance:view', { departmentId: r.department_id, branchId: r.branch_id }).allow || can(c.subject, 'attendance:review', { departmentId: r.department_id, branchId: r.branch_id }).allow);
  const onLeave = new Set((await c.q.query<{ employee_id: string }>(`select employee_id from leave_requests where status = 'approved' and $1::date between start_date and end_date`, [d])).map((r) => r.employee_id));
  const board = visible.map((r) => {
    let status: 'present' | 'late' | 'absent' | 'leave' | 'off' = 'off';
    if (r.clock_in_at) status = r.late_minutes > 0 ? 'late' : 'present';
    else if (onLeave.has(r.id)) status = 'leave';
    else if (r.shift_name) status = 'absent';
    return { ...r, status, missingClockOut: r.session_status === 'missed_clock_out' };
  });
  const count = (s: string) => board.filter((b) => b.status === s).length;
  return { date: d, board, summary: { present: count('present'), late: count('late'), absent: count('absent'), leave: count('leave'), missingClockOut: board.filter((b) => b.missingClockOut).length, flagged: board.filter((b) => b.clock_in_result === 'requires_review').length } };
}

// ---- Rosters ---------------------------------------------------------------------------------------------------------------------------------------------
export async function weekRoster(c: Ctx, weekStart: string) {
  need(c, 'roster:manage');
  const end = addDays(weekStart, 6);
  const [entries, employees] = await Promise.all([
    c.q.query<any>(`select r.id, r.employee_id, r.work_date::text as d, s.name, s.code, s.start_time, s.end_time from roster_entries r join shifts s on s.id = r.shift_id
      where r.work_date between $1::date and $2::date and r.status = 'published' and r.superseded_at is null order by s.start_time`, [weekStart, end]),
    c.q.query<any>(`select e.id, e.full_name, a.department_id, a.branch_id from employees e left join assignments a on a.employee_id = e.id and a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)
      where e.status in ('active','on_leave') order by e.full_name`),
  ]);
  const visible = employees.filter((e) => can(c.subject, 'roster:manage', { departmentId: e.department_id, branchId: e.branch_id }).allow);
  return { weekStart, days: Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), employees: visible, entries };
}

export async function assignRoster(c: Ctx, i: { employeeId: string; shiftId: string; dates: string[] }) {
  const emp = (await c.q.query<any>(
    `select e.id, a.department_id, a.branch_id from employees e left join assignments a on a.employee_id = e.id and a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date) where e.id = $1`, [i.employeeId]))[0];
  if (!emp) throw new UserError('Unknown employee.');
  need(c, 'roster:manage', { departmentId: emp.department_id, branchId: emp.branch_id });
  const shift = (await c.q.query<any>('select * from shifts where id = $1 and archived_at is null', [i.shiftId]))[0];
  if (!shift) throw new UserError('Unknown shift.');
  if (i.dates.length === 0 || i.dates.length > 62 || !i.dates.every(isDate)) throw new UserError('Choose between 1 and 62 valid dates.');
  const sh = mapShift(shift);
  const created: string[] = [], blocked: string[] = [], warnings: string[] = [];
  const leave = (await c.q.query<any>(`select start_date::text as s, end_date::text as e from leave_requests where employee_id = $1 and status = 'approved'`, [i.employeeId])).map((l) => ({ start: l.s, end: l.e }));
  for (const date of [...new Set(i.dates)].sort()) {
    const near = await c.q.query<any>(
      `select r.work_date::text as date, s.start_time, s.end_time, s.name from roster_entries r join shifts s on s.id = r.shift_id
        where r.employee_id = $1 and r.status = 'published' and r.superseded_at is null and r.work_date between $2::date and $3::date`, [i.employeeId, addDays(date, -1), addDays(date, 1)]);
    const report = detectRosterConflicts(
      near.map((n) => ({ date: n.date, startMin: toMin(String(n.start_time)), endMin: toMin(String(n.end_time)), name: n.name })),
      { date, startMin: toMin(sh.start), endMin: toMin(sh.end), name: sh.name }, { approvedLeave: leave });
    if (report.blocking.length) { blocked.push(`${date}: ${report.blocking.join(' ')}`); continue; }
    warnings.push(...report.warnings);
    await c.q.query(`insert into roster_entries (org_id, employee_id, shift_id, work_date, created_by) values ($1,$2,$3,$4,$5)`, [c.orgId, i.employeeId, i.shiftId, date, c.userId]);
    created.push(date);
  }
  if (created.length) await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'roster.assigned', entity: 'employee', entityId: i.employeeId, after: { shift: sh.code, dates: created }, ip: c.ip, userAgent: c.userAgent });
  return { created, blocked, warnings };
}

export async function cancelRoster(c: Ctx, entryId: string, reason: string) {
  const e = (await c.q.query<any>(`select r.id, r.employee_id, a.department_id, a.branch_id from roster_entries r left join assignments a on a.employee_id = r.employee_id and a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date) where r.id = $1 and r.superseded_at is null`, [entryId]))[0];
  if (!e) throw new UserError('Roster entry not found.');
  need(c, 'roster:manage', { departmentId: e.department_id, branchId: e.branch_id });
  if (!reason.trim()) throw new UserError('A reason is required to cancel a rostered shift.');
  await c.q.query(`update roster_entries set status = 'cancelled', superseded_at = now() where id = $1`, [entryId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'roster.cancelled', entity: 'roster_entry', entityId: entryId, reason, ip: c.ip, userAgent: c.userAgent });
}

// ---- Leave ---------------------------------------------------------------------------------------------------------------------------------------------------------
export async function leaveOverview(c: Ctx) {
  need(c, 'leave:request');
  const emp = await myEmployee(c);
  const types = await c.q.query<any>('select id, name, annual_days, paid from leave_types where archived_at is null order by name');
  const year = new Date().getUTCFullYear();
  const used = await c.q.query<any>(`select leave_type_id, coalesce(sum(days),0) as d from leave_requests where employee_id = $1 and status = 'approved' and extract(year from start_date) = $2 group by 1`, [emp.id, year]);
  const pending = await c.q.query<any>(`select leave_type_id, coalesce(sum(days),0) as d from leave_requests where employee_id = $1 and status = 'pending' and extract(year from start_date) = $2 group by 1`, [emp.id, year]);
  const mine = await c.q.query<any>(`select r.id, t.name as type, r.start_date::text as s, r.end_date::text as e, r.days, r.status, r.decision_note from leave_requests r join leave_types t on t.id = r.leave_type_id where r.employee_id = $1 order by r.created_at desc limit 20`, [emp.id]);
  const bal = types.map((t) => {
    const ent = Number(t.annual_days), u = Number(used.find((x) => x.leave_type_id === t.id)?.d ?? 0), p = Number(pending.find((x) => x.leave_type_id === t.id)?.d ?? 0);
    return { id: t.id, name: t.name, entitlement: ent, used: u, pending: p, remaining: ent > 0 ? ent - u - p : null };
  });
  return { balances: bal, requests: mine };
}

export async function requestLeave(c: Ctx, i: { typeId: string; start: string; end: string; reason?: string }) {
  need(c, 'leave:request');
  const emp = await myEmployee(c);
  if (!isDate(i.start) || !isDate(i.end) || i.end < i.start) throw new UserError('Choose a valid start and end date.');
  if (i.start < today()) throw new UserError('Leave cannot start in the past. Use an attendance request for past dates.');
  const type = (await c.q.query<any>('select * from leave_types where id = $1 and archived_at is null', [i.typeId]))[0];
  if (!type) throw new UserError('Unknown leave type.');
  const days = countDays(i.start, i.end);
  if (days <= 0) throw new UserError('That range contains no working days.');
  const overlap = await c.q.query(`select 1 from leave_requests where employee_id = $1 and status in ('pending','approved') and start_date <= $3::date and end_date >= $2::date`, [emp.id, i.start, i.end]);
  if (overlap[0]) throw new UserError('You already have leave requested or approved on some of those dates.');
  if (Number(type.annual_days) > 0) {
    const year = Number(i.start.slice(0, 4));
    const used = Number((await c.q.query<any>(`select coalesce(sum(days),0) d from leave_requests where employee_id = $1 and leave_type_id = $2 and status in ('pending','approved') and extract(year from start_date) = $3`, [emp.id, i.typeId, year]))[0].d);
    if (used + days > Number(type.annual_days)) throw new UserError(`Not enough ${type.name} balance: ${Number(type.annual_days) - used} day(s) left, you asked for ${days}.`);
  }
  const r = await c.q.query<{ id: string }>(`insert into leave_requests (org_id, employee_id, leave_type_id, start_date, end_date, days, reason) values ($1,$2,$3,$4,$5,$6,$7) returning id`, [c.orgId, emp.id, i.typeId, i.start, i.end, days, i.reason?.trim() || null]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'leave.requested', entity: 'leave_request', entityId: r[0].id, after: { type: type.name, start: i.start, end: i.end, days }, ip: c.ip, userAgent: c.userAgent });
}

export async function pendingLeave(c: Ctx) {
  need(c, 'leave:review');
  const rows = await c.q.query<any>(
    `select r.id, r.start_date::text as s, r.end_date::text as e, r.days, r.reason, t.name as type, e.full_name, e.id as employee_id, a.department_id, a.branch_id, d.name as department,
            (select count(*)::int from roster_entries re where re.employee_id = r.employee_id and re.status = 'published' and re.superseded_at is null and re.work_date between r.start_date and r.end_date) as rostered
       from leave_requests r join leave_types t on t.id = r.leave_type_id join employees e on e.id = r.employee_id
       left join assignments a on a.employee_id = e.id and a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)
       left join departments d on d.id = a.department_id where r.status = 'pending' order by r.start_date`);
  return rows.filter((r) => can(c.subject, 'leave:review', { departmentId: r.department_id, branchId: r.branch_id }).allow);
}

export async function reviewLeave(c: Ctx, id: string, approve: boolean, note: string) {
  const r = (await c.q.query<any>(
    `select r.*, e.user_id as emp_user, a.department_id, a.branch_id from leave_requests r join employees e on e.id = r.employee_id
       left join assignments a on a.employee_id = e.id and a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)
      where r.id = $1 for update of r`, [id]))[0];
  if (!r || r.status !== 'pending') throw new UserError('This request has already been decided.');
  need(c, 'leave:review', { departmentId: r.department_id, branchId: r.branch_id });
  if (r.emp_user === c.userId) throw new UserError('You cannot approve your own leave. Another reviewer must decide it.'); // separation of duties
  if (!approve && !note.trim()) throw new UserError('Give a reason for rejecting.');
  await c.q.query(`update leave_requests set status = $2, decided_by = $3, decided_at = now(), decision_note = $4 where id = $1`, [id, approve ? 'approved' : 'rejected', c.userId, note.trim() || null]);
  let rosterNote = '';
  if (approve) {
    const cancelled = await c.q.query<{ id: string }>(`update roster_entries set status = 'cancelled', superseded_at = now() where employee_id = $1 and status = 'published' and superseded_at is null and work_date between $2::date and $3::date returning id`, [r.employee_id, r.start_date, r.end_date]);
    if (cancelled.length) rosterNote = ` ${cancelled.length} rostered shift(s) were released for reassignment.`;
  }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: approve ? 'leave.approved' : 'leave.rejected', entity: 'leave_request', entityId: id, reason: note || undefined, ip: c.ip, userAgent: c.userAgent });
  if (r.emp_user) await notify(c.q, c.orgId, r.emp_user, `Your leave request was ${approve ? 'approved' : 'rejected'}`, (note || '') + rosterNote, '/leave');
  return rosterNote.trim();
}

export async function addLeaveType(c: Ctx, name: string, annualDays: number, paid: boolean) {
  need(c, 'leave:manage');
  if (name.trim().length < 2) throw new UserError('Enter a leave type name.');
  if (!(annualDays >= 0 && annualDays <= 365)) throw new UserError('Annual days must be between 0 and 365 (0 = not capped).');
  await c.q.query('insert into leave_types (org_id, name, annual_days, paid) values ($1,$2,$3,$4)', [c.orgId, name.trim(), annualDays, paid]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'leave_type.created', entity: 'leave_type', after: { name, annualDays, paid }, ip: c.ip, userAgent: c.userAgent });
}

export async function listLeaveTypes(q: Q) {
  return q.query<any>('select id, name, annual_days, paid from leave_types where archived_at is null order by name');
}
