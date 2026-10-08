import { can } from '../domain/policy';
import { need, type Ctx } from './ctx';
import { computeCard } from './kpi';

const CUR = `a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)`;

/** Performance flags: plain, explainable warning signs. Nothing here is a verdict; it tells a manager who to talk to. */
export interface Flag { code: string; label: string; detail: string; severity: 'watch' | 'act' }
export interface PersonFlags { employeeId: string; name: string; department: string | null; flags: Flag[] }

export interface Signals { lates30: number; missedOuts30: number; overdueTasks: number; kpi: number | null; assessmentFailed: boolean }
export const THRESHOLDS = { lates: 3, missedOuts: 1, overdue: 3, kpiLow: 50, assessmentPass: 50 };

/** Pure rule set so it can be tested without a database. */
export function flagsFrom(s: Signals): Flag[] {
  const out: Flag[] = [];
  if (s.lates30 >= THRESHOLDS.lates) out.push({ code: 'late', label: 'Repeated lateness', detail: `${s.lates30} late arrivals in the last 30 days`, severity: s.lates30 >= THRESHOLDS.lates * 2 ? 'act' : 'watch' });
  if (s.missedOuts30 >= THRESHOLDS.missedOuts) out.push({ code: 'clockout', label: 'Missed clock-out', detail: `${s.missedOuts30} shift(s) closed automatically or left open in the last 30 days`, severity: s.missedOuts30 >= 3 ? 'act' : 'watch' });
  if (s.overdueTasks >= THRESHOLDS.overdue) out.push({ code: 'overdue', label: 'Overdue tasks', detail: `${s.overdueTasks} tasks are past their due date`, severity: s.overdueTasks >= 6 ? 'act' : 'watch' });
  if (s.kpi != null && s.kpi < THRESHOLDS.kpiLow) out.push({ code: 'kpi', label: 'Low KPI', detail: `This month's KPI is ${s.kpi.toFixed(0)}%`, severity: s.kpi < 40 ? 'act' : 'watch' });
  if (s.assessmentFailed) out.push({ code: 'assessment', label: 'Knowledge assessment', detail: `Scored below ${THRESHOLDS.assessmentPass}% or not taken`, severity: 'watch' });
  return out;
}

async function signalsFor(c: Ctx, employeeId: string, period: string): Promise<Signals> {
  const q = c.q;
  const att = (await q.query<any>(`select count(*) filter (where late_minutes > 0)::int as lates, count(*) filter (where status = 'missed_clock_out' or 'auto_closed' = any(flags))::int as missed from attendance_sessions where employee_id = $1 and work_date >= current_date - 30`, [employeeId]))[0];
  const od = (await q.query<{ n: number }>(`select count(*)::int n from tasks where assignee_employee_id = $1 and status in ('todo','in_progress','blocked') and due_date < current_date`, [employeeId]))[0].n;
  const card = await computeCard(q, c.orgId, employeeId, period, false, 60);
  const as = (await q.query<any>(`select score_pct from assessment_attempts t join assessments a on a.id = t.assessment_id where t.employee_id = $1 and a.period = $2`, [employeeId, period]))[0];
  const hasAssessment = (await q.query<any>(`select 1 from assessments where period = $1 and opens_on <= current_date limit 1`, [period]))[0];
  const failed = as ? as.score_pct != null && Number(as.score_pct) < THRESHOLDS.assessmentPass : !!hasAssessment && new Date().getUTCDate() > 20;
  return { lates30: att.lates, missedOuts30: att.missed, overdueTasks: od, kpi: card?.score ?? null, assessmentFailed: failed };
}

export async function myFlags(c: Ctx): Promise<Flag[]> {
  need(c, 'kpi:view:own');
  if (!c.subject.employeeId) return [];
  return flagsFrom(await signalsFor(c, c.subject.employeeId, new Date().toISOString().slice(0, 7)));
}

/** Everyone the viewer may see (department/branch scope) who has at least one flag, worst first. */
export async function teamFlags(c: Ctx): Promise<PersonFlags[]> {
  need(c, 'kpi:view');
  const period = new Date().toISOString().slice(0, 7);
  const people = await c.q.query<any>(`select e.id, e.full_name, d.name as dept, a.department_id, a.branch_id from employees e left join assignments a on a.employee_id = e.id and ${CUR} left join departments d on d.id = a.department_id where e.status <> 'exited' and not e.hidden order by e.full_name limit 300`);
  const out: PersonFlags[] = [];
  for (const p of people) {
    if (!can(c.subject, 'kpi:view', { departmentId: p.department_id, branchId: p.branch_id }).allow) continue;
    const flags = flagsFrom(await signalsFor(c, p.id, period));
    if (flags.length) out.push({ employeeId: p.id, name: p.full_name, department: p.dept, flags });
  }
  const weight = (f: PersonFlags) => f.flags.reduce((a, x) => a + (x.severity === 'act' ? 3 : 1), 0);
  return out.sort((a, b) => weight(b) - weight(a));
}
