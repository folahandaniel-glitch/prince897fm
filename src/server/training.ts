import { addMonths } from '../domain/training';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import type { Q } from './db';
import { notify } from './hr';

const isDate = (s?: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const today = () => new Date().toISOString().slice(0, 10);

export const listCourses = (q: Q) => q.query<any>(`select id, name, description, mandatory, valid_months from training_courses where archived_at is null order by mandatory desc, name`);

export async function createCourse(c: Ctx, i: { name: string; description?: string; mandatory?: boolean; validMonths?: number | null }) {
  need(c, 'training:manage');
  if (i.name.trim().length < 2) throw new UserError('Enter the course name.');
  if (i.validMonths != null && !(Number.isInteger(i.validMonths) && i.validMonths >= 1 && i.validMonths <= 240)) throw new UserError('Validity must be between 1 and 240 months, or empty if it never expires.');
  if ((await c.q.query('select 1 from training_courses where lower(name) = lower($1)', [i.name.trim()]))[0]) throw new UserError('A course with that name already exists.');
  const r = await c.q.query<{ id: string }>('insert into training_courses (org_id, name, description, mandatory, valid_months) values ($1,$2,$3,$4,$5) returning id', [c.orgId, i.name.trim(), i.description?.trim() || null, !!i.mandatory, i.validMonths ?? null]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'training.course_created', entity: 'training_course', entityId: r[0].id, after: { name: i.name.trim(), mandatory: !!i.mandatory }, ip: c.ip, userAgent: c.userAgent });
  return r[0].id;
}

export async function assignTraining(c: Ctx, i: { courseId: string; employeeIds: string[]; dueOn?: string }) {
  need(c, 'training:manage');
  if (i.dueOn && !isDate(i.dueOn)) throw new UserError('Enter a valid due date.');
  const course = (await c.q.query<any>('select id, name from training_courses where id = $1 and archived_at is null', [i.courseId]))[0];
  if (!course) throw new UserError('Unknown course.');
  if (!i.employeeIds.length) throw new UserError('Choose at least one person.');
  let n = 0;
  for (const id of i.employeeIds) {
    const e = (await c.q.query<any>(`select id, user_id from employees where id = $1 and status <> 'exited'`, [id]))[0];
    if (!e) continue;
    if ((await c.q.query(`select 1 from training_records where employee_id = $1 and course_id = $2 and status = 'assigned'`, [id, i.courseId]))[0]) continue; // already open
    await c.q.query(`insert into training_records (org_id, employee_id, course_id, due_on, assigned_by) values ($1,$2,$3,$4,$5)`, [c.orgId, id, i.courseId, i.dueOn || null, c.userId]);
    if (e.user_id) await notify(c.q, c.orgId, e.user_id, `Training assigned: ${course.name}`, i.dueOn ? `Please complete it by ${i.dueOn}.` : undefined, '/training');
    n++;
  }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'training.assigned', entity: 'training_course', entityId: i.courseId, after: { people: n }, ip: c.ip, userAgent: c.userAgent });
  return n;
}

export async function recordResult(c: Ctx, recordId: string, i: { passed: boolean; completedOn: string; score?: string; certificateRef?: string; notes?: string }) {
  need(c, 'training:manage');
  if (!isDate(i.completedOn) || i.completedOn > today()) throw new UserError('Enter the completion date (not in the future).');
  const r = (await c.q.query<any>(`select r.id, r.status, r.employee_id, e.user_id, c.name, c.valid_months from training_records r join training_courses c on c.id = r.course_id join employees e on e.id = r.employee_id where r.id = $1 for update of r`, [recordId]))[0];
  if (!r) throw new UserError('Training record not found.');
  if (r.status !== 'assigned') throw new UserError('This record already has a result. Assign the course again if it must be retaken.');
  let score: number | null = null;
  if (i.score?.trim()) { score = Number(i.score); if (!(score >= 0 && score <= 100)) throw new UserError('Score must be between 0 and 100.'); }
  const expires = i.passed && r.valid_months ? addMonths(i.completedOn, r.valid_months) : null;
  await c.q.query(`update training_records set status = $2, completed_on = $3, expires_on = $4, score = $5, certificate_ref = $6, notes = $7 where id = $1`,
    [recordId, i.passed ? 'completed' : 'failed', i.completedOn, expires, score, i.certificateRef?.trim() || null, i.notes?.trim() || null]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'training.result_recorded', entity: 'training_record', entityId: recordId, after: { passed: i.passed, expires }, ip: c.ip, userAgent: c.userAgent });
  if (r.user_id) await notify(c.q, c.orgId, r.user_id, i.passed ? `Training completed: ${r.name}` : `Training not passed: ${r.name}`, expires ? `Valid until ${expires}.` : undefined, '/training');
}

const BASE = `select r.id, r.status, r.due_on::text as due_on, r.completed_on::text as completed_on, r.expires_on::text as expires_on, r.score, r.certificate_ref, r.notes,
  c.id as course_id, c.name as course, c.mandatory, e.id as employee_id, e.full_name, e.employee_no,
  case when r.status = 'assigned' and r.due_on < current_date then 'overdue'
       when r.status = 'completed' and r.expires_on < current_date then 'expired'
       when r.status = 'completed' and r.expires_on <= current_date + 30 then 'expiring'
       else r.status end as state
  from training_records r join training_courses c on c.id = r.course_id join employees e on e.id = r.employee_id`;

export async function myTraining(c: Ctx) {
  need(c, 'training:view:own');
  if (!c.subject.employeeId) return [];
  return c.q.query<any>(`${BASE} where r.employee_id = $1 order by (r.status = 'assigned') desc, r.due_on nulls last, r.created_at desc`, [c.subject.employeeId]);
}

export async function listRecords(c: Ctx, f: { state?: string; courseId?: string } = {}) {
  need(c, 'training:manage');
  const where: string[] = []; const p: unknown[] = [];
  if (f.courseId) { p.push(f.courseId); where.push(`r.course_id = $${p.length}`); }
  const rows = await c.q.query<any>(`${BASE} ${where.length ? 'where ' + where.join(' and ') : ''} order by r.created_at desc limit 300`, p);
  return f.state ? rows.filter((r) => r.state === f.state) : rows;
}

/** Mandatory courses: who has no current (completed and unexpired) certificate. */
export async function complianceGaps(c: Ctx) {
  need(c, 'training:manage');
  return c.q.query<any>(`select c.id as course_id, c.name as course, e.id as employee_id, e.full_name, e.employee_no,
      exists (select 1 from training_records r where r.employee_id = e.id and r.course_id = c.id and r.status = 'assigned') as assigned
    from training_courses c cross join employees e
    where c.mandatory and c.archived_at is null and e.status <> 'exited'
      and not exists (select 1 from training_records r where r.employee_id = e.id and r.course_id = c.id and r.status = 'completed' and (r.expires_on is null or r.expires_on >= current_date))
    order by c.name, e.full_name limit 500`);
}

/** Cron: due-soon / overdue assignments and certificates expiring within 30 days. De-duplicated per record and state. */
export async function trainingAlerts(q: Q, orgId: string): Promise<number> {
  const rows = await q.query<any>(`select r.id, r.state, r.due_on, r.expires_on, r.course, r.full_name, e.user_id from (${BASE}) r join employees e on e.id = r.employee_id where r.state in ('overdue','expiring','expired')`);
  const hr = await q.query<{ user_id: string }>(`select distinct ur.user_id from user_roles ur join roles r on r.id = ur.role_id where r.permissions && array['training:manage'] and r.key <> 'super_admin' limit 10`);
  let n = 0;
  for (const r of rows) {
    const text = r.state === 'overdue' ? `Training overdue: ${r.course}` : r.state === 'expired' ? `Certificate expired: ${r.course}` : `Certificate expiring soon: ${r.course}`;
    const detail = r.state === 'overdue' ? `Was due ${r.due_on}.` : `Expiry date ${r.expires_on}.`;
    for (const u of new Set([r.user_id, ...hr.map((h) => h.user_id)].filter(Boolean) as string[])) {
      const x = await q.query(`insert into notifications (org_id, user_id, title, body, href, dedupe_key) values ($1,$2,$3,$4,$5,$6) on conflict do nothing returning id`,
        [orgId, u, u === r.user_id ? text : `${text} (${r.full_name})`, detail, u === r.user_id ? '/training' : '/training/manage', `training:${r.id}:${r.state}:${u}`]);
      if (x[0]) n++;
    }
  }
  return n;
}
