import { fromDb } from '../domain/finance';
import { can } from '../domain/policy';
import { need, UserError, type Ctx } from './ctx';

const CUR = `a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)`;
export type HubKind = 'attendance' | 'leave' | 'payroll' | 'tasks';
export interface HubTable { title: string; head: string[]; rows: (string | number)[][] }

const okPeriod = (p: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
const bounds = (p: string) => { const [y, m] = p.split('-').map(Number); const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`; return { from: `${p}-01`, next }; };
const kobo = (n: unknown) => (fromDb(n as string) / 100).toFixed(2);

/** Which people the viewer may include in a HR-style report, by department/branch scope. */
async function scopedPeople(c: Ctx, perm: string) {
  const people = await c.q.query<any>(`select e.id, e.full_name, e.employee_no, d.name as dept, a.department_id, a.branch_id from employees e left join assignments a on a.employee_id = e.id and ${CUR} left join departments d on d.id = a.department_id where e.status <> 'exited' and not e.hidden order by e.full_name limit 500`);
  return people.filter((p) => can(c.subject, perm, { departmentId: p.department_id, branchId: p.branch_id }).allow);
}

export async function hubReport(c: Ctx, kind: HubKind, period: string): Promise<HubTable> {
  if (!okPeriod(period)) throw new UserError('Choose a month.');
  const { from, next } = bounds(period);
  if (kind === 'attendance') {
    const people = await scopedPeople(c, 'attendance:view'); if (!people.length) need(c, 'attendance:view');
    const ids = people.map((p) => p.id);
    const rows = await c.q.query<any>(`select employee_id, count(*)::int as days, count(*) filter (where late_minutes > 0)::int as lates, coalesce(sum(late_minutes),0)::int as late_min, count(*) filter (where status = 'missed_clock_out' or 'auto_closed' = any(flags))::int as missed from attendance_sessions where work_date >= $1 and work_date < $2 and employee_id = any($3::uuid[]) group by employee_id`, [from, next, ids]);
    const by = new Map(rows.map((r) => [r.employee_id, r]));
    return { title: `Attendance ${period}`, head: ['No.', 'Name', 'Department', 'Days worked', 'Late arrivals', 'Minutes late', 'Missed clock-outs'], rows: people.map((p) => { const r = by.get(p.id); return [p.employee_no ?? '', p.full_name, p.dept ?? '', r?.days ?? 0, r?.lates ?? 0, r?.late_min ?? 0, r?.missed ?? 0]; }) };
  }
  if (kind === 'leave') {
    const people = await scopedPeople(c, 'leave:review'); if (!people.length) need(c, 'leave:review');
    const rows = await c.q.query<any>(`select r.employee_id, t.name as type, r.start_date::text as s, r.end_date::text as e, r.days, r.status from leave_requests r join leave_types t on t.id = r.leave_type_id where r.start_date < $2 and r.end_date >= $1 and r.status in ('approved','pending') and r.employee_id = any($3::uuid[]) order by r.start_date`, [from, next, people.map((p) => p.id)]);
    const name = new Map(people.map((p) => [p.id, p]));
    return { title: `Leave ${period}`, head: ['Name', 'Department', 'Leave type', 'From', 'To', 'Days', 'Status'], rows: rows.map((r) => [name.get(r.employee_id)?.full_name ?? '', name.get(r.employee_id)?.dept ?? '', r.type, r.s, r.e, Number(r.days), r.status]) };
  }
  if (kind === 'payroll') {
    need(c, 'payroll:view');
    const rows = await c.q.query<any>(`select s.employee_snapshot->>'name' as name, s.employee_snapshot->>'number' as num, s.employee_snapshot->>'department' as dept, s.gross, s.total_deductions, s.net, r.status from payslips s join pay_runs r on r.id = s.run_id where s.period = $1 and r.status <> 'cancelled' order by 1`, [period]);
    return { title: `Payroll ${period} (₦)`, head: ['No.', 'Name', 'Department', 'Gross', 'Deductions', 'Net', 'Run status'], rows: rows.map((r) => [r.num ?? '', r.name ?? '', r.dept ?? '', kobo(r.gross), kobo(r.total_deductions), kobo(r.net), r.status]) };
  }
  const people = await scopedPeople(c, 'task:assign'); if (!people.length) need(c, 'task:assign');
  const rows = await c.q.query<any>(`select assignee_employee_id as id, count(*)::int as total, count(*) filter (where status = 'done')::int as done, count(*) filter (where status in ('todo','in_progress','blocked'))::int as open, count(*) filter (where status in ('todo','in_progress','blocked') and due_date < current_date)::int as overdue from tasks where created_at < $2 and (completed_at is null or completed_at >= $1) and assignee_employee_id = any($3::uuid[]) group by 1`, [from, next, people.map((p) => p.id)]);
  const by = new Map(rows.map((r) => [r.id, r]));
  return { title: `Tasks ${period}`, head: ['Name', 'Department', 'Total', 'Done', 'Open', 'Overdue'], rows: people.map((p) => { const r = by.get(p.id); return [p.full_name, p.dept ?? '', r?.total ?? 0, r?.done ?? 0, r?.open ?? 0, r?.overdue ?? 0]; }) };
}

const cell = (v: unknown) => { const s = String(v ?? ''); return /^[=+\-@]/.test(s) ? `'${s}` : s; };
const q = (v: unknown) => `"${cell(v).replace(/"/g, '""')}"`;
export const hubCsv = (t: HubTable) => '﻿' + [t.head, ...t.rows].map((r) => r.map(q).join(',')).join('\r\n');

/** Invoice payments received and paid out, newest first. */
export async function listPayments(c: Ctx, limit = 200) {
  need(c, 'finance:view');
  const rows = await c.q.query<any>(`select p.id, p.paid_on::text as paid_on, p.cash, p.wht, p.reference, i.id as invoice_id, i.number, i.kind, f.name as party from fin_invoice_payments p join fin_invoices i on i.id = p.invoice_id join fin_parties f on f.id = i.party_id order by p.paid_on desc, p.created_at desc limit $1`, [limit]);
  return rows.map((r) => ({ ...r, cashMinor: fromDb(r.cash), whtMinor: fromDb(r.wht) }));
}

/** Late-arrival excuses: staff explanations filed as attendance exceptions of kind "late", with their decision. */
export async function listExcuses(c: Ctx, mine: boolean) {
  if (mine) need(c, 'attendance:clock'); else need(c, 'attendance:review');
  return c.q.query<any>(`select x.id, x.work_date::text as work_date, x.note, x.status, x.decision_note, e.full_name from attendance_exceptions x join employees e on e.id = x.employee_id where x.kind = 'late' ${mine ? 'and x.employee_id = $1' : ''} order by x.created_at desc limit 200`, mine ? [c.subject.employeeId] : []);
}
