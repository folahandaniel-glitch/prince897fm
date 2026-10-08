import { can } from '../domain/policy';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import type { Q } from './db';
import { notify } from './hr';

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'];

async function myEmployeeId(q: Q, userId: string) {
  return (await q.query<{ id: string }>('select id from employees where user_id = $1', [userId]))[0]?.id ?? null;
}

export async function createTask(c: Ctx, i: { title: string; description?: string; assigneeId?: string | null; projectId?: string | null; parentId?: string | null; priority?: string; dueDate?: string }) {
  need(c, 'task:create');
  const title = i.title.trim();
  if (title.length < 2 || title.length > 200) throw new UserError('Give the task a title (2 to 200 characters).');
  const priority = i.priority || 'normal';
  if (!PRIORITIES.includes(priority)) throw new UserError('Unknown priority.');
  if (i.dueDate && !(dateRe.test(i.dueDate) && !Number.isNaN(Date.parse(i.dueDate)))) throw new UserError('Enter a valid due date.');
  const mine = await myEmployeeId(c.q, c.userId);
  let assignee = i.assigneeId || mine;
  if (assignee && assignee !== mine) need(c, 'task:assign'); // assigning work to others is a separate permission
  if (assignee) {
    const ok = await c.q.query('select 1 from employees where id = $1', [assignee]);
    if (!ok[0]) throw new UserError('Unknown assignee.');
  }
  if (i.projectId) { const p = await c.q.query('select 1 from projects where id = $1 and status = $2', [i.projectId, 'active']); if (!p[0]) throw new UserError('Unknown or inactive project.'); }
  if (i.parentId) { const p = await c.q.query('select 1 from tasks where id = $1 and parent_id is null', [i.parentId]); if (!p[0]) throw new UserError('Subtasks can only be added to a top-level task.'); }
  const r = await c.q.query<{ id: string }>(
    `insert into tasks (org_id, project_id, parent_id, title, description, assignee_employee_id, created_by, priority, due_date) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [c.orgId, i.projectId || null, i.parentId || null, title, i.description?.trim() || null, assignee, c.userId, priority, i.dueDate || null]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'task.created', entity: 'task', entityId: r[0].id, after: { title, assignee, priority, due: i.dueDate }, ip: c.ip, userAgent: c.userAgent });
  if (assignee && assignee !== mine) {
    const u = (await c.q.query<{ user_id: string | null }>('select user_id from employees where id = $1', [assignee]))[0]?.user_id;
    if (u) await notify(c.q, c.orgId, u, 'New task assigned to you', title, `/tasks/${r[0].id}`);
  }
  return r[0].id;
}

export async function listTasks(c: Ctx, scope: 'mine' | 'created' | 'team', status?: string) {
  const mine = await myEmployeeId(c.q, c.userId);
  if (scope === 'team') need(c, 'task:assign');
  const where: string[] = []; const params: unknown[] = [];
  if (scope === 'mine') { params.push(mine); where.push(`t.assignee_employee_id = $${params.length}`); }
  if (scope === 'created') { params.push(c.userId); where.push(`t.created_by = $${params.length}`); }
  if (status === 'open') where.push(`t.status in ('todo','in_progress','blocked')`);
  else if (status && STATUSES.includes(status)) { params.push(status); where.push(`t.status = $${params.length}`); }
  const rows = await c.q.query<any>(
    `select t.id, t.title, t.status, t.priority, t.due_date::text as due, t.parent_id, t.project_id, p.name as project, e.full_name as assignee, a.department_id, a.branch_id,
            (t.due_date < current_date and t.status in ('todo','in_progress','blocked')) as overdue
       from tasks t left join projects p on p.id = t.project_id left join employees e on e.id = t.assignee_employee_id
       left join assignments a on a.employee_id = e.id and a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)
      ${where.length ? 'where ' + where.join(' and ') : ''}
      order by (t.status in ('done','cancelled')), t.due_date nulls last, case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end limit 200`, params);
  return scope === 'team' ? rows.filter((r) => can(c.subject, 'task:assign', { departmentId: r.department_id, branchId: r.branch_id }).allow) : rows;
}

export async function getTask(c: Ctx, id: string) {
  const t = (await c.q.query<any>(
    `select t.*, t.due_date::text as due, p.name as project, e.full_name as assignee, e.user_id as assignee_user, cu.email as creator, a.department_id, a.branch_id
       from tasks t left join projects p on p.id = t.project_id left join employees e on e.id = t.assignee_employee_id left join users cu on cu.id = t.created_by
       left join assignments a on a.employee_id = e.id and a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)
      where t.id = $1`, [id]))[0];
  if (!t) return null;
  const involved = t.assignee_user === c.userId || t.created_by === c.userId;
  if (!involved) need(c, 'task:assign', { departmentId: t.department_id, branchId: t.branch_id });
  const [comments, subtasks] = await Promise.all([
    c.q.query<any>('select tc.id, tc.body, tc.created_at, u.email from task_comments tc join users u on u.id = tc.user_id where tc.task_id = $1 order by tc.id', [id]),
    c.q.query<any>('select id, title, status from tasks where parent_id = $1 order by created_at', [id]),
  ]);
  return { task: t, comments, subtasks, canManage: involved || can(c.subject, 'task:assign', { departmentId: t.department_id, branchId: t.branch_id }).allow };
}

export async function setTaskStatus(c: Ctx, id: string, status: string) {
  if (!STATUSES.includes(status)) throw new UserError('Unknown status.');
  const t = (await c.q.query<any>(`select t.*, e.user_id as assignee_user, a.department_id, a.branch_id from tasks t left join employees e on e.id = t.assignee_employee_id
    left join assignments a on a.employee_id = e.id and a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date) where t.id = $1 for update of t`, [id]))[0];
  if (!t) throw new UserError('Task not found.');
  if (!(t.assignee_user === c.userId || t.created_by === c.userId)) need(c, 'task:assign', { departmentId: t.department_id, branchId: t.branch_id });
  await c.q.query(`update tasks set status = $2, completed_at = case when $2 = 'done' then now() else null end, updated_at = now() where id = $1`, [id, status]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'task.status_changed', entity: 'task', entityId: id, before: { status: t.status }, after: { status }, ip: c.ip, userAgent: c.userAgent });
  if (t.created_by !== c.userId && status === 'done') await notify(c.q, c.orgId, t.created_by, 'A task you assigned was completed', t.title, `/tasks/${id}`);
}

export async function addComment(c: Ctx, taskId: string, body: string) {
  const t = await getTask(c, taskId); // enforces visibility
  if (!t) throw new UserError('Task not found.');
  const b = body.trim();
  if (!b) throw new UserError('Write a comment first.');
  await c.q.query('insert into task_comments (org_id, task_id, user_id, body) values ($1,$2,$3,$4)', [c.orgId, taskId, c.userId, b.slice(0, 4000)]);
  const other = t.task.assignee_user && t.task.assignee_user !== c.userId ? t.task.assignee_user : t.task.created_by !== c.userId ? t.task.created_by : null;
  if (other) await notify(c.q, c.orgId, other, 'New comment on a task', t.task.title, `/tasks/${taskId}`);
}

export async function createProject(c: Ctx, name: string) {
  need(c, 'task:assign');
  if (name.trim().length < 2) throw new UserError('Enter a project name.');
  const owner = await myEmployeeId(c.q, c.userId);
  const r = await c.q.query<{ id: string }>('insert into projects (org_id, name, owner_employee_id) values ($1,$2,$3) returning id', [c.orgId, name.trim(), owner]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'project.created', entity: 'project', entityId: r[0].id, after: { name }, ip: c.ip, userAgent: c.userAgent });
}

export async function listProjects(q: Q) {
  return q.query<any>(`select p.id, p.name, p.status, (select count(*)::int from tasks t where t.project_id = p.id and t.status in ('todo','in_progress','blocked')) as open_tasks from projects p where p.status = 'active' order by p.name`);
}

export async function assignableEmployees(c: Ctx) {
  if (!can(c.subject, 'task:assign').allow) return [];
  return c.q.query<any>(`select id, full_name from employees where status in ('active','on_leave') order by full_name`);
}
