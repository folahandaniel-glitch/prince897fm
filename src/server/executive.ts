import { localParts } from '../domain/attendance';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import { compliance } from './reports';

const CUR = `a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)`;

export interface Alert { level: 'critical' | 'warning' | 'info'; text: string; href?: string }

/**
 * Organisation-wide oversight. Gated by `dashboard:executive` (an explicit grant, not an implicit "see everything"),
 * and every drill-down is written to the audit trail.
 */
export async function overview(c: Ctx) {
  need(c, 'dashboard:executive');
  const tz = (await c.q.query<{ timezone: string }>('select timezone from organizations where id = $1', [c.orgId]))[0]?.timezone ?? 'Africa/Lagos';
  const date = localParts(new Date(), tz).date;

  const [people] = await c.q.query<any>(`select count(*)::int total, count(*) filter (where status = 'active')::int active, count(*) filter (where status = 'on_leave')::int on_leave from employees`);
  const [att] = await c.q.query<any>(
    `select count(*) filter (where s.clock_in_at is not null)::int present, count(*) filter (where s.late_minutes > 0)::int late,
            count(*) filter (where s.clock_in_result = 'requires_review')::int flagged, count(*) filter (where s.status = 'missed_clock_out')::int missed
       from attendance_sessions s where s.work_date = $1::date`, [date]);
  const [rostered] = await c.q.query<any>(
    `select count(distinct r.employee_id)::int n, count(distinct r.employee_id) filter (where not exists (select 1 from attendance_sessions s where s.employee_id = r.employee_id and s.work_date = r.work_date))::int absent
       from roster_entries r where r.work_date = $1::date and r.status = 'published' and r.superseded_at is null
        and not exists (select 1 from leave_requests l where l.employee_id = r.employee_id and l.status = 'approved' and $1::date between l.start_date and l.end_date)`, [date]);
  const [pend] = await c.q.query<any>(
    `select (select count(*) from attendance_exceptions where status = 'pending_review')::int exceptions, (select count(*) from leave_requests where status = 'pending')::int leave,
            (select count(*) from registration_requests where status = 'pending')::int registrations, (select count(*) from reports where status in ('submitted','under_review'))::int reports,
            (select count(*) from attendance_exceptions where status = 'pending_review' and created_at < now() - interval '48 hours')::int stale_exceptions,
            (select count(*) from leave_requests where status = 'pending' and created_at < now() - interval '48 hours')::int stale_leave`);
  const [tasks] = await c.q.query<any>(`select count(*) filter (where status in ('todo','in_progress','blocked'))::int open, count(*) filter (where due_date < current_date and status in ('todo','in_progress','blocked'))::int overdue, count(*) filter (where status = 'blocked')::int blocked from tasks`);
  const comp = await compliance(c).catch(() => []);
  const sens = await c.q.query<any>(`select action, count(*)::int n from audit_events where created_at > now() - interval '7 days' and action in ('config.published','config.rolled_back','registration.approved','employee.transferred','attendance.corrected') group by 1 order by n desc`);

  const byDept = await c.q.query<any>(
    `select d.id, d.name, count(distinct e.id)::int headcount,
            count(distinct e.id) filter (where s.clock_in_at is not null)::int present,
            count(distinct t.id) filter (where t.due_date < current_date and t.status in ('todo','in_progress','blocked'))::int overdue_tasks
       from departments d
       left join assignments a on a.department_id = d.id and ${CUR}
       left join employees e on e.id = a.employee_id and e.status in ('active','on_leave')
       left join attendance_sessions s on s.employee_id = e.id and s.work_date = $1::date
       left join tasks t on t.assignee_employee_id = e.id
      where d.archived_at is null group by d.id, d.name having count(distinct e.id) > 0 order by headcount desc`, [date]);

  const feed = await c.q.query<any>(`select a.id, a.action, a.entity, a.created_at, u.email as actor from audit_events a left join users u on u.id = a.actor_user_id order by a.id desc limit 12`);

  const alerts: Alert[] = [];
  if (rostered.absent > 0) alerts.push({ level: 'warning', text: `${rostered.absent} rostered staff have not clocked in today.`, href: '/attendance/team' });
  if (att.missed > 0) alerts.push({ level: 'warning', text: `${att.missed} session(s) with a missing clock-out.`, href: '/attendance/team' });
  if (att.flagged > 0) alerts.push({ level: 'info', text: `${att.flagged} clock-in(s) flagged for review today.`, href: '/attendance/team' });
  if (pend.stale_exceptions + pend.stale_leave > 0) alerts.push({ level: 'warning', text: `${pend.stale_exceptions + pend.stale_leave} approval request(s) have waited more than 48 hours.`, href: '/leave/review' });
  for (const k of comp) { const od = k.missing.filter((m: any) => m.overdue).length; if (od > 0) alerts.push({ level: 'critical', text: `${od} overdue submission(s): ${k.template}.`, href: '/reports/oversight' }); }
  if (tasks.overdue > 0) alerts.push({ level: 'warning', text: `${tasks.overdue} overdue task(s).`, href: '/tasks?scope=team&status=open' });
  if (pend.registrations > 0) alerts.push({ level: 'info', text: `${pend.registrations} registration(s) awaiting approval.`, href: '/requests' });

  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'executive.viewed', entity: 'dashboard', after: { view: 'overview' } });
  return { date, people, att, rostered, pend, tasks, comp, sens, byDept, feed, alerts };
}

/** Department drill-down: who is where today, what is overdue. Access is logged. */
export async function departmentDetail(c: Ctx, departmentId: string) {
  need(c, 'dashboard:executive');
  const tz = (await c.q.query<{ timezone: string }>('select timezone from organizations where id = $1', [c.orgId]))[0]?.timezone ?? 'Africa/Lagos';
  const date = localParts(new Date(), tz).date;
  const dept = (await c.q.query<any>('select id, name from departments where id = $1', [departmentId]))[0];
  if (!dept) throw new UserError('Department not found.');
  const people = await c.q.query<any>(
    `select e.id, e.full_name, p.name as position, s.clock_in_at, s.late_minutes, s.status as session_status,
            (select count(*)::int from tasks t where t.assignee_employee_id = e.id and t.due_date < current_date and t.status in ('todo','in_progress','blocked')) as overdue_tasks,
            (select r.status from reports r where r.employee_id = e.id order by r.period_start desc limit 1) as last_report
       from employees e join assignments a on a.employee_id = e.id and ${CUR} left join positions p on p.id = a.position_id
       left join attendance_sessions s on s.employee_id = e.id and s.work_date = $2::date
      where a.department_id = $1 and e.status in ('active','on_leave') order by e.full_name`, [departmentId, date]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'executive.drilldown', entity: 'department', entityId: departmentId, ip: c.ip, userAgent: c.userAgent });
  return { dept, date, people };
}
