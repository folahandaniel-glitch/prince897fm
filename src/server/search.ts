import { can } from '../domain/policy';
import type { Ctx } from './ctx';

export interface Hit { kind: string; title: string; subtitle?: string; href: string }

/** Permission-aware search: a user never sees even the existence of records outside their access. */
export async function search(c: Ctx, raw: string): Promise<Hit[]> {
  const q = raw.trim().toLowerCase();
  if (q.length < 2) return [];
  const like = `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
  const hits: Hit[] = [];

  if (can(c.subject, 'employee:view').allow) {
    const rows = await c.q.query<any>(
      `select e.id, e.full_name, e.employee_no, d.name as department, a.department_id, a.branch_id from employees e
         left join assignments a on a.employee_id = e.id and a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)
         left join departments d on d.id = a.department_id
        where lower(e.full_name) like $1 or lower(e.employee_no) like $1 or lower(e.email) like $1 order by e.full_name limit 12`, [like]);
    for (const r of rows) if (can(c.subject, 'employee:view', { departmentId: r.department_id, branchId: r.branch_id }).allow) hits.push({ kind: 'Employee', title: r.full_name, subtitle: `${r.employee_no}${r.department ? ' · ' + r.department : ''}`, href: `/employees/${r.id}` });
  }

  const sees = can(c.subject, 'task:assign').allow;
  const tasks = await c.q.query<any>(
    `select t.id, t.title, t.status, e.user_id as assignee_user, t.created_by from tasks t left join employees e on e.id = t.assignee_employee_id
      where lower(t.title) like $1 order by t.created_at desc limit 12`, [like]);
  for (const t of tasks) if (sees || t.assignee_user === c.userId || t.created_by === c.userId) hits.push({ kind: 'Task', title: t.title, subtitle: t.status.replace('_', ' '), href: `/tasks/${t.id}` });

  if (can(c.subject, 'structure:manage').allow || can(c.subject, 'employee:view').allow) {
    const depts = await c.q.query<any>(`select id, name from departments where lower(name) like $1 and archived_at is null limit 5`, [like]);
    for (const d of depts) hits.push({ kind: 'Department', title: d.name, href: can(c.subject, 'dashboard:executive').allow ? `/executive/department/${d.id}` : '/admin/structure' });
  }
  return hits.slice(0, 25);
}
