import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import type { Q } from './db';

/**
 * Where each person may clock in from. The default is "on site": inside an authorised workplace. HR and administrators can give
 * exceptions for people whose work is not tied to one building (hybrid staff, reporters in the field, marketing, outside broadcasts).
 * Exceptions never switch the record off: the location is still captured when the device shares it, and the entry is flagged.
 */
export const MODES: { key: string; label: string; help: string; temporary?: boolean }[] = [
  { key: 'on_site', label: 'On site only', help: 'Must be inside an assigned workplace to clock in (the default).' },
  { key: 'multi_branch', label: 'Any branch', help: 'May clock in at any branch, office or the headquarters, not only the assigned one.' },
  { key: 'hybrid', label: 'Hybrid', help: 'Works from anywhere on the chosen days of the week and on site on the other days.' },
  { key: 'remote', label: 'Remote', help: 'May clock in from anywhere, every working day.' },
  { key: 'field', label: 'Field duty (reporters, marketing, sales)', help: 'Works outside the office; may clock in from anywhere.' },
  { key: 'outside_broadcast', label: 'Outside broadcast / assignment (temporary)', help: 'May clock in from anywhere between two dates, for an event or special assignment.', temporary: true },
];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface EffectiveMode { mode: string; exemptKind: 'remote' | 'field' | null; anyBranch: boolean }

/** The rule that applies to this person on this date (an expired temporary exception falls back to on site). */
export async function effectiveMode(q: Q, employeeId: string, date: string): Promise<EffectiveMode> {
  const r = (await q.query<any>(`select mode, remote_weekdays, valid_from::text as vf, valid_to::text as vt from attendance_modes where employee_id = $1`, [employeeId]))[0];
  const onSite: EffectiveMode = { mode: 'on_site', exemptKind: null, anyBranch: false };
  if (!r) return onSite;
  if ((r.vf && date < r.vf) || (r.vt && date > r.vt)) return onSite;
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  switch (r.mode) {
    case 'multi_branch': return { mode: r.mode, exemptKind: null, anyBranch: true };
    case 'hybrid': return { mode: r.mode, exemptKind: (r.remote_weekdays as number[]).includes(dow) ? 'remote' : null, anyBranch: false };
    case 'remote': return { mode: r.mode, exemptKind: 'remote', anyBranch: false };
    case 'field': case 'outside_broadcast': return { mode: r.mode, exemptKind: 'field', anyBranch: false };
    default: return onSite;
  }
}

export async function listModes(c: Ctx) {
  need(c, 'attendance:manage');
  return c.q.query<any>(`select e.id, e.full_name, e.employee_no, d.name as department, m.mode, m.remote_weekdays, m.valid_from::text as valid_from, m.valid_to::text as valid_to, m.reason, m.updated_at
    from employees e left join assignments a on a.employee_id = e.id and a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)
    left join departments d on d.id = a.department_id left join attendance_modes m on m.employee_id = e.id
    where e.status <> 'exited' and not e.hidden order by d.name nulls last, e.full_name`);
}

export async function setMode(c: Ctx, employeeId: string, i: { mode: string; remoteWeekdays?: number[]; validFrom?: string; validTo?: string; reason?: string }) {
  need(c, 'attendance:manage');
  const def = MODES.find((m) => m.key === i.mode);
  if (!def) throw new UserError('Choose a valid arrangement.');
  if (!(await c.q.query('select 1 from employees where id = $1 and not hidden', [employeeId]))[0]) throw new UserError('Employee not found.');
  const isDate = (s?: string) => !s || (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)));
  if (!isDate(i.validFrom) || !isDate(i.validTo)) throw new UserError('Enter valid dates.');
  if (i.validFrom && i.validTo && i.validTo < i.validFrom) throw new UserError('The end date cannot be before the start date.');
  const days = [...new Set((i.remoteWeekdays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (i.mode === 'hybrid') {
    if (days.length === 0) throw new UserError('Choose at least one day of the week for working away from the office.');
    if (days.length > 5) throw new UserError('A hybrid arrangement keeps at least two days on site. Use Remote instead.');
  }
  if (def.temporary && (!i.validFrom || !i.validTo)) throw new UserError('An outside-broadcast exception needs a start and an end date.');
  if (['remote', 'field', 'outside_broadcast', 'hybrid'].includes(i.mode) && (i.reason?.trim().length ?? 0) < 5) throw new UserError('Say why (for example "Reporter on field duty" or "Hybrid agreement signed 1 March").');
  if (i.mode === 'on_site') {
    await c.q.query('delete from attendance_modes where employee_id = $1', [employeeId]);
  } else {
    await c.q.query(`insert into attendance_modes (org_id, employee_id, mode, remote_weekdays, valid_from, valid_to, reason, set_by) values ($1,$2,$3,$4::int[],$5,$6,$7,$8)
      on conflict (employee_id) do update set mode = excluded.mode, remote_weekdays = excluded.remote_weekdays, valid_from = excluded.valid_from, valid_to = excluded.valid_to, reason = excluded.reason, set_by = excluded.set_by, updated_at = now()`,
      [c.orgId, employeeId, i.mode, i.mode === 'hybrid' ? days : [], i.validFrom || null, i.validTo || null, i.reason?.trim() || null, c.userId]);
  }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'attendance.mode_set', entity: 'employee', entityId: employeeId, after: { mode: i.mode, days, from: i.validFrom, to: i.validTo, reason: i.reason }, ip: c.ip, userAgent: c.userAgent });
}
