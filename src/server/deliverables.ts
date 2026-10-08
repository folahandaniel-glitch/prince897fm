import { bandOfRank, LEVEL_BANDS, type LevelBand } from '../domain/kpi';
import { can } from '../domain/policy';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import type { Q } from './db';
import { notify } from './hr';

/**
 * Deliverables: the concrete outputs a department expects from its people (for a radio station: scripts, show logs, news stories, jingles,
 * campaign reports...). HR/administrators define them; staff submit; a supervisor approves or returns. Approved deliverables feed the KPI.
 */
const CUR = `a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)`;
export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'once'] as const;
const okPeriod = (p: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

export async function listDefs(c: Ctx) {
  need(c, 'deliverable:review');
  return c.q.query<any>(`select d.id, d.name, d.description, d.department_id, d.level_band, d.frequency, d.target_count, d.active, dep.name as department from deliverable_defs d left join departments dep on dep.id = d.department_id order by d.active desc, dep.name nulls first, d.name`);
}

export async function saveDef(c: Ctx, i: { id?: string; name: string; description?: string; departmentId?: string | null; levelBand?: string | null; frequency: string; targetCount: number; active?: boolean }) {
  need(c, 'deliverable:manage');
  const name = i.name.trim();
  if (name.length < 2 || name.length > 160) throw new UserError('Give the deliverable a name.');
  if (!(FREQUENCIES as readonly string[]).includes(i.frequency)) throw new UserError('Choose how often it is expected.');
  if (!(Number.isInteger(i.targetCount) && i.targetCount >= 1 && i.targetCount <= 1000)) throw new UserError('The monthly target must be a whole number from 1 to 1000.');
  const band = i.levelBand ? LEVEL_BANDS.find((b) => b.key === i.levelBand)?.key ?? null : null;
  if (i.levelBand && !band) throw new UserError('Unknown level.');
  if (i.departmentId && !(await c.q.query('select 1 from departments where id = $1', [i.departmentId]))[0]) throw new UserError('Unknown department.');
  if ((await c.q.query('select 1 from deliverable_defs where lower(name) = lower($1) and department_id is not distinct from $2 and level_band is not distinct from $3 and id is distinct from $4', [name, i.departmentId || null, band, i.id ?? null]))[0]) throw new UserError('That deliverable already exists for this department and level.');
  let id = i.id;
  if (id) {
    const r = await c.q.query('update deliverable_defs set name=$2, description=$3, department_id=$4, level_band=$5, frequency=$6, target_count=$7, active=$8 where id=$1 returning id', [id, name, i.description?.trim() || null, i.departmentId || null, band, i.frequency, i.targetCount, i.active ?? true]);
    if (!r[0]) throw new UserError('Deliverable not found.');
  } else {
    id = (await c.q.query<{ id: string }>('insert into deliverable_defs (org_id, name, description, department_id, level_band, frequency, target_count, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id', [c.orgId, name, i.description?.trim() || null, i.departmentId || null, band, i.frequency, i.targetCount, c.userId]))[0].id;
  }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: i.id ? 'deliverable.def_updated' : 'deliverable.def_created', entity: 'deliverable_def', entityId: id!, after: { name, frequency: i.frequency, target: i.targetCount }, ip: c.ip, userAgent: c.userAgent });
  return id!;
}

async function me(q: Q, c: Ctx) {
  if (!c.subject.employeeId) throw new UserError('Your login is not linked to an employee record. Ask HR to link it.');
  return (await q.query<any>(`select e.id, a.department_id, p.rank_level from employees e left join assignments a on a.employee_id = e.id and ${CUR} left join positions p on p.id = a.position_id where e.id = $1`, [c.subject.employeeId]))[0];
}

/** What is expected of me, with this month's progress. */
export async function myExpectations(c: Ctx, period: string) {
  need(c, 'deliverable:submit');
  if (!okPeriod(period)) throw new UserError('Choose a month.');
  const e = await me(c.q, c);
  const band = bandOfRank(e.rank_level) as LevelBand;
  const defs = await c.q.query<any>(`select d.id, d.name, d.description, d.frequency, d.target_count,
      (select count(*)::int from deliverables x where x.def_id = d.id and x.employee_id = $1 and x.period = $2 and x.status = 'approved') as approved,
      (select count(*)::int from deliverables x where x.def_id = d.id and x.employee_id = $1 and x.period = $2 and x.status = 'submitted') as waiting,
      (select count(*)::int from deliverables x where x.def_id = d.id and x.employee_id = $1 and x.period = $2 and x.status = 'returned') as returned
    from deliverable_defs d where d.active and (d.department_id is null or d.department_id is not distinct from $3) and (d.level_band is null or d.level_band = $4) order by d.name`, [e.id, period, e.department_id, band]);
  return defs;
}

export async function mySubmissions(c: Ctx, period: string) {
  need(c, 'deliverable:submit');
  if (!c.subject.employeeId) return [];
  return c.q.query<any>(`select x.id, x.title, x.notes, x.link, x.status, x.due_on::text as due_on, x.on_time, x.submitted_at, x.review_note, d.name as def from deliverables x join deliverable_defs d on d.id = x.def_id where x.employee_id = $1 and x.period = $2 order by x.submitted_at desc`, [c.subject.employeeId, period]);
}

export async function submitDeliverable(c: Ctx, i: { defId: string; title: string; notes?: string; link?: string; dueOn?: string; period?: string }) {
  need(c, 'deliverable:submit');
  const e = await me(c.q, c);
  const period = i.period && okPeriod(i.period) ? i.period : new Date().toISOString().slice(0, 7);
  if (i.title.trim().length < 2) throw new UserError('Give your submission a title.');
  if (i.link?.trim() && !/^https?:\/\/[^\s]+$/i.test(i.link.trim())) throw new UserError('A link must start with http:// or https://.');
  if (i.dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(i.dueOn)) throw new UserError('Enter a valid due date.');
  const defs = await myExpectations(c, period);
  if (!defs.some((d: any) => d.id === i.defId)) throw new UserError('That deliverable is not expected of you.');
  const onTime = i.dueOn ? new Date().toISOString().slice(0, 10) <= i.dueOn : null;
  const r = await c.q.query<{ id: string }>(`insert into deliverables (org_id, def_id, employee_id, period, title, notes, link, due_on, on_time) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [c.orgId, i.defId, e.id, period, i.title.trim(), i.notes?.trim() || null, i.link?.trim() || null, i.dueOn || null, onTime]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'deliverable.submitted', entity: 'deliverable', entityId: r[0].id, after: { title: i.title.trim(), period }, ip: c.ip, userAgent: c.userAgent });
  return r[0].id;
}

/** Everything waiting for review in the departments the reviewer looks after. */
export async function reviewQueue(c: Ctx, status = 'submitted') {
  need(c, 'deliverable:review');
  const rows = await c.q.query<any>(`select x.id, x.title, x.notes, x.link, x.status, x.period, x.due_on::text as due_on, x.on_time, x.submitted_at, x.review_note, d.name as def, e.id as employee_id, e.full_name, e.user_id, a.department_id, a.branch_id, dep.name as department
    from deliverables x join deliverable_defs d on d.id = x.def_id join employees e on e.id = x.employee_id left join assignments a on a.employee_id = e.id and ${CUR} left join departments dep on dep.id = a.department_id
    where x.status = $1 order by x.submitted_at limit 200`, [status]);
  return rows.filter((r) => can(c.subject, 'deliverable:review', { departmentId: r.department_id, branchId: r.branch_id }).allow);
}

export async function reviewDeliverable(c: Ctx, id: string, approve: boolean, note: string) {
  const x = (await c.q.query<any>(`select x.*, e.user_id, a.department_id, a.branch_id from deliverables x join employees e on e.id = x.employee_id left join assignments a on a.employee_id = e.id and ${CUR} where x.id = $1 for update of x`, [id]))[0];
  if (!x) throw new UserError('Deliverable not found.');
  need(c, 'deliverable:review', { departmentId: x.department_id, branchId: x.branch_id });
  if (x.status !== 'submitted') throw new UserError('This one has already been reviewed.');
  if (c.subject.employeeId === x.employee_id) throw new UserError('Separation of duties: you cannot review your own deliverable.');
  if (!approve && note.trim().length < 3) throw new UserError('Say what needs to change when returning a deliverable.');
  await c.q.query(`update deliverables set status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4 where id = $1`, [id, approve ? 'approved' : 'returned', c.userId, note.trim() || null]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: approve ? 'deliverable.approved' : 'deliverable.returned', entity: 'deliverable', entityId: id, reason: note.trim() || null, ip: c.ip, userAgent: c.userAgent });
  if (x.user_id) await notify(c.q, c.orgId, x.user_id, approve ? `Deliverable approved: ${x.title}` : `Deliverable returned: ${x.title}`, note.trim() || undefined, '/deliverables');
}

/** KPI input: approved deliverables against the monthly target of everything expected of this person. */
export async function deliverableScore(q: Q, employeeId: string, period: string): Promise<number | null> {
  const e = (await q.query<any>(`select a.department_id, p.rank_level from employees e left join assignments a on a.employee_id = e.id and ${CUR} left join positions p on p.id = a.position_id where e.id = $1`, [employeeId]))[0];
  if (!e) return null;
  const band = bandOfRank(e.rank_level);
  const r = (await q.query<any>(`select coalesce(sum(d.target_count),0)::int as target, coalesce(sum(least(d.target_count, (select count(*) from deliverables x where x.def_id = d.id and x.employee_id = $1 and x.period = $2 and x.status = 'approved'))),0)::int as done
    from deliverable_defs d where d.active and (d.department_id is null or d.department_id is not distinct from $3) and (d.level_band is null or d.level_band = $4)`, [employeeId, period, e.department_id, band]))[0];
  return r.target > 0 ? Math.round((r.done / r.target) * 10000) / 100 : null;
}
