import { canActOnStep, dueInstant, nextStep, periodFor, reportState, type Cadence, type ChainStep, type ReportContext } from '../domain/reports';
import { localParts } from '../domain/attendance';
import { can } from '../domain/policy';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import type { Q } from './db';
import { notify } from './hr';

export interface FieldDef { key: string; label: string; type: 'text' | 'longtext' | 'number'; required: boolean }

const CUR = `a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'field';

async function orgTz(q: Q, orgId: string) {
  return (await q.query<{ timezone: string }>('select timezone from organizations where id = $1', [orgId]))[0]?.timezone ?? 'Africa/Lagos';
}
async function me(c: Ctx) {
  const e = (await c.q.query<any>(`select e.id, e.full_name, a.department_id, a.supervisor_id, d.name as department from employees e left join assignments a on a.employee_id = e.id and ${CUR} left join departments d on d.id = a.department_id where e.user_id = $1`, [c.userId]))[0];
  if (!e) throw new UserError('Your login is not linked to an employee record. Ask HR to link it.');
  return e as { id: string; full_name: string; department_id: string | null; supervisor_id: string | null; department: string | null };
}

// ---- Templates ------------------------------------------------------------------------------------------------------------------------
export async function listTemplates(q: Q) {
  return q.query<any>('select id, name, cadence, due_weekday, due_time::text as due_time, fields, chain, department_ids, active from report_templates order by active desc, name');
}

export async function saveTemplate(c: Ctx, i: { name: string; cadence: Cadence; dueWeekday?: number; dueTime: string; fields: { label: string; type: string; required: boolean }[]; chain: ChainStep[] }) {
  need(c, 'report:manage');
  if (i.name.trim().length < 3) throw new UserError('Enter a report name.');
  if (!['weekly', 'monthly'].includes(i.cadence)) throw new UserError('Choose weekly or monthly.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(i.dueTime)) throw new UserError('Enter the deadline time as HH:MM.');
  const fields: FieldDef[] = i.fields.filter((f) => f.label.trim()).map((f) => ({ key: slug(f.label), label: f.label.trim(), type: (['text', 'longtext', 'number'].includes(f.type) ? f.type : 'text') as FieldDef['type'], required: !!f.required }));
  if (fields.length === 0) throw new UserError('Add at least one question.');
  if (new Set(fields.map((f) => f.key)).size !== fields.length) throw new UserError('Question labels must be different from each other.');
  const roles = new Set((await c.q.query<{ key: string }>('select key from roles')).map((r) => r.key));
  for (const s of i.chain) if (s.kind === 'role' && !roles.has(s.roleKey)) throw new UserError(`Unknown role "${s.roleKey}" in the approval chain.`);
  const r = await c.q.query<{ id: string }>(
    `insert into report_templates (org_id, name, cadence, due_weekday, due_time, fields, chain) values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) returning id`,
    [c.orgId, i.name.trim(), i.cadence, i.cadence === 'weekly' ? i.dueWeekday ?? 5 : null, i.dueTime, JSON.stringify(fields), JSON.stringify(i.chain)]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'report_template.created', entity: 'report_template', entityId: r[0].id, after: { name: i.name, cadence: i.cadence, dueTime: i.dueTime, chain: i.chain }, ip: c.ip, userAgent: c.userAgent });
}

export async function setTemplateActive(c: Ctx, id: string, active: boolean) {
  need(c, 'report:manage');
  await c.q.query('update report_templates set active = $2 where id = $1', [id, active]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: active ? 'report_template.enabled' : 'report_template.disabled', entity: 'report_template', entityId: id, ip: c.ip, userAgent: c.userAgent });
}

// ---- My reports -------------------------------------------------------------------------------------------------------------------------
/** Ensure the current period's draft exists for each template that applies to this employee, then return them. */
export async function myReports(c: Ctx) {
  need(c, 'report:submit');
  const emp = await me(c);
  const tz = await orgTz(c.q, c.orgId);
  const local = localParts(new Date(), tz).date;
  const templates = await c.q.query<any>(`select * from report_templates where active and (department_ids is null or $1::uuid = any(department_ids))`, [emp.department_id]);
  for (const t of templates) {
    const p = periodFor(t.cadence, local, t.due_weekday ?? 5);
    await c.q.query(
      `insert into reports (org_id, template_id, employee_id, period_start, period_end, due_at) values ($1,$2,$3,$4,$5,$6) on conflict (template_id, employee_id, period_start) do nothing`,
      [c.orgId, t.id, emp.id, p.start, p.end, dueInstant(p, String(t.due_time), tz)]);
  }
  const rows = await c.q.query<any>(
    `select r.id, r.status, r.period_start::text as ps, r.period_end::text as pe, r.due_at, r.submitted_at, r.on_time, r.step, r.answers, t.name, t.cadence, t.fields, t.chain,
            (select note from report_reviews v where v.report_id = r.id order by v.id desc limit 1) as last_note
       from reports r join report_templates t on t.id = r.template_id where r.employee_id = $1 order by r.period_start desc, t.name limit 40`, [emp.id]);
  return rows.map((r) => ({ ...r, state: reportState({ status: r.status, dueAt: r.due_at }) }));
}

export async function submitReport(c: Ctx, id: string, answers: Record<string, string>, submit: boolean) {
  need(c, 'report:submit');
  const emp = await me(c);
  const r = (await c.q.query<any>(`select r.*, t.fields, t.chain from reports r join report_templates t on t.id = r.template_id where r.id = $1 and r.employee_id = $2 for update of r`, [id, emp.id]))[0];
  if (!r) throw new UserError('Report not found.');
  if (!['draft', 'returned'].includes(r.status)) throw new UserError('This report can no longer be edited.');
  const fields: FieldDef[] = r.fields;
  const clean: Record<string, string> = {};
  for (const f of fields) {
    const v = (answers[f.key] ?? '').toString().trim().slice(0, 8000);
    if (submit && f.required && !v) throw new UserError(`Please answer: ${f.label}`);
    if (v && f.type === 'number' && !Number.isFinite(Number(v))) throw new UserError(`${f.label} must be a number.`);
    clean[f.key] = v;
  }
  if (!submit) {
    await c.q.query('update reports set answers = $2::jsonb, updated_at = now() where id = $1', [id, JSON.stringify(clean)]);
    return { status: r.status, message: 'Draft saved.' };
  }
  // Freeze who the supervisor and department were at this moment (history must stay answerable).
  const sup = emp.supervisor_id;
  const supName = sup ? (await c.q.query<{ full_name: string }>('select full_name from employees where id = $1', [sup]))[0]?.full_name ?? null : null;
  const chain: ChainStep[] = r.chain;
  const ctx: ReportContext = { supervisorUserId: null, supervisorEmployeeId: sup, departmentId: emp.department_id };
  const step = nextStep(chain, 0, ctx);
  const done = step >= chain.length;
  const now = new Date();
  await c.q.query(
    `update reports set answers = $2::jsonb, status = $3, step = $4, submitted_at = $5, on_time = $6, ctx_department_id = $7, ctx_department = $8, ctx_supervisor_id = $9, ctx_supervisor = $10,
            chain_snapshot = $11::jsonb, updated_at = now() where id = $1`,
    [id, JSON.stringify(clean), done ? 'approved' : 'submitted', done ? chain.length : step, now, now <= new Date(r.due_at), emp.department_id, emp.department, sup, supName, JSON.stringify(chain)]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'report.submitted', entity: 'report', entityId: id, after: { onTime: now <= new Date(r.due_at), department: emp.department, supervisor: supName, firstStep: done ? 'none (auto-approved: no approvers in chain)' : chain[step] }, ip: c.ip, userAgent: c.userAgent });
  if (!done) await notifyStep(c.q, c.orgId, chain[step], sup, `Report awaiting your review`, `${emp.full_name} submitted a report.`);
  return { status: done ? 'approved' : 'submitted', message: done ? 'Submitted. No approvers are configured, so it was recorded as approved.' : 'Submitted for review.' };
}

async function notifyStep(q: Q, orgId: string, step: ChainStep, supervisorEmployeeId: string | null, title: string, body: string) {
  let users: string[] = [];
  if (step.kind === 'supervisor' && supervisorEmployeeId) users = (await q.query<{ user_id: string }>('select user_id from employees where id = $1 and user_id is not null', [supervisorEmployeeId])).map((r) => r.user_id);
  if (step.kind === 'role') users = (await q.query<{ user_id: string }>(`select distinct ur.user_id from user_roles ur join roles r on r.id = ur.role_id where r.key = $1 and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date) limit 20`, [step.roleKey])).map((r) => r.user_id);
  for (const u of users) await notify(q, orgId, u, title, body, '/reports/review');
}

// ---- Review ------------------------------------------------------------------------------------------------------------------------------
export async function reviewQueue(c: Ctx) {
  need(c, 'report:review');
  const rows = await c.q.query<any>(
    `select r.id, r.status, r.step, r.period_start::text as ps, r.period_end::text as pe, r.submitted_at, r.on_time, r.answers, r.ctx_department_id, r.ctx_department, r.ctx_supervisor_id, r.ctx_supervisor, r.chain_snapshot,
            e.full_name, e.id as employee_id, e.user_id as emp_user, t.name as template, t.fields,
            (select coalesce(json_agg(json_build_object('step', v.step, 'by', v.reviewer_user_id, 'decision', v.decision, 'note', v.note) order by v.id), '[]'::json) from report_reviews v where v.report_id = r.id) as reviews
       from reports r join employees e on e.id = r.employee_id join report_templates t on t.id = r.template_id
      where r.status in ('submitted','under_review') order by r.submitted_at`);
  return rows.filter((r) => {
    if (r.emp_user === c.userId) return false;                                  // never your own report
    const step: ChainStep | undefined = r.chain_snapshot?.[r.step];
    if (!step) return false;
    if ((r.reviews as any[]).some((v) => v.by === c.userId)) return false;      // one person cannot approve two stages
    return canActOnStep(step, c.subject, { supervisorUserId: null, supervisorEmployeeId: r.ctx_supervisor_id, departmentId: r.ctx_department_id });
  });
}

export async function decideReport(c: Ctx, id: string, decision: 'approved' | 'returned' | 'rejected', note: string) {
  need(c, 'report:review');
  const r = (await c.q.query<any>(`select r.*, e.user_id as emp_user, e.full_name from reports r join employees e on e.id = r.employee_id where r.id = $1 for update of r`, [id]))[0];
  if (!r || !['submitted', 'under_review'].includes(r.status)) throw new UserError('This report is not awaiting review.');
  if (r.emp_user === c.userId) throw new UserError('You cannot review your own report.');
  const chain: ChainStep[] = r.chain_snapshot ?? [];
  const step = chain[r.step];
  const ctx: ReportContext = { supervisorUserId: null, supervisorEmployeeId: r.ctx_supervisor_id, departmentId: r.ctx_department_id };
  if (!step || !canActOnStep(step, c.subject, ctx)) throw new UserError('This report is not at your approval stage.');
  const prior = await c.q.query('select 1 from report_reviews where report_id = $1 and reviewer_user_id = $2', [id, c.userId]);
  if (prior[0]) throw new UserError('Separation of duties: you already reviewed an earlier stage of this report.');
  if (decision !== 'approved' && !note.trim()) throw new UserError('Please explain why you are returning or rejecting this report.');
  await c.q.query('insert into report_reviews (org_id, report_id, step, reviewer_user_id, decision, note) values ($1,$2,$3,$4,$5,$6)', [c.orgId, id, r.step, c.userId, decision, note.trim() || null]);
  let status = r.status, nextIdx = r.step;
  if (decision === 'approved') {
    nextIdx = nextStep(chain, r.step + 1, ctx);
    status = nextIdx >= chain.length ? 'approved' : 'under_review';
  } else status = decision; // returned | rejected
  await c.q.query('update reports set status = $2, step = $3, updated_at = now() where id = $1', [id, status, decision === 'returned' ? 0 : nextIdx]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: `report.${decision}`, entity: 'report', entityId: id, before: { status: r.status, step: r.step }, after: { status, step: nextIdx }, reason: note || undefined, ip: c.ip, userAgent: c.userAgent });
  if (r.emp_user) await notify(c.q, c.orgId, r.emp_user, status === 'approved' ? 'Your report was approved' : status === 'under_review' ? 'Your report moved to the next review stage' : `Your report was ${decision}`, note || undefined, '/reports');
  if (status === 'under_review') await notifyStep(c.q, c.orgId, chain[nextIdx], r.ctx_supervisor_id, 'Report awaiting your review', `${r.full_name}'s report is ready for you.`);
  return status as string;
}

// ---- Compliance (oversight) and reminders -----------------------------------------------------------------------------------------
export async function compliance(c: Ctx) {
  need(c, 'report:oversee');
  const tz = await orgTz(c.q, c.orgId);
  const local = localParts(new Date(), tz).date;
  const templates = await c.q.query<any>(`select * from report_templates where active order by name`);
  const out = [];
  for (const t of templates) {
    const p = periodFor(t.cadence, local, t.due_weekday ?? 5);
    const due = dueInstant(p, String(t.due_time), tz);
    const rows = await c.q.query<any>(
      `select e.id, e.full_name, d.name as department, r.status, r.on_time, r.submitted_at
         from employees e left join assignments a on a.employee_id = e.id and ${CUR} left join departments d on d.id = a.department_id
         left join reports r on r.employee_id = e.id and r.template_id = $1 and r.period_start = $2::date
        where e.status in ('active','on_leave') and e.user_id is not null and ($3::uuid[] is null or a.department_id = any($3::uuid[])) order by d.name nulls last, e.full_name`, [t.id, p.start, t.department_ids]);
    const submitted = rows.filter((r) => ['submitted', 'under_review', 'approved'].includes(r.status ?? ''));
    const pastDue = new Date() > due;
    out.push({
      template: t.name, period: `${p.start} → ${p.end}`, due, expected: rows.length, submitted: submitted.length,
      onTime: submitted.filter((r) => r.on_time).length,
      missing: rows.filter((r) => !submitted.includes(r)).map((r) => ({ id: r.id, name: r.full_name, department: r.department, overdue: pastDue })),
    });
  }
  return out;
}

/** Daily/hourly sweep: "due soon" and "overdue" notices, de-duplicated so nobody is nagged twice. */
export async function sendReportReminders(q: Q, orgId: string): Promise<number> {
  const tz = await orgTz(q, orgId);
  const local = localParts(new Date(), tz).date;
  let sent = 0;
  for (const t of await q.query<any>(`select * from report_templates where active`)) {
    const p = periodFor(t.cadence, local, t.due_weekday ?? 5);
    const due = dueInstant(p, String(t.due_time), tz);
    const hours = (due.getTime() - Date.now()) / 3_600_000;
    const phase = hours < 0 ? 'overdue' : hours <= 24 ? 'soon' : null;
    if (!phase) continue;
    const rows = await q.query<any>(
      `select e.user_id, e.full_name, sup.user_id as sup_user from employees e
         left join assignments a on a.employee_id = e.id and ${CUR} left join employees sup on sup.id = a.supervisor_id
         left join reports r on r.employee_id = e.id and r.template_id = $1 and r.period_start = $2::date
        where e.status = 'active' and e.user_id is not null and coalesce(r.status, 'draft') in ('draft','returned') and ($3::uuid[] is null or a.department_id = any($3::uuid[]))`, [t.id, p.start, t.department_ids]);
    for (const r of rows) {
      const key = `rpt:${t.id}:${p.start}:${phase}`;
      const ins = async (user: string, title: string, body: string) => {
        const x = await q.query(`insert into notifications (org_id, user_id, title, body, href, priority, dedupe_key) values ($1,$2,$3,$4,'/reports',$5,$6) on conflict do nothing returning id`, [orgId, user, title, body, phase === 'overdue' ? 'high' : 'normal', key]);
        if (x[0]) sent++;
      };
      await ins(r.user_id, phase === 'soon' ? `${t.name} is due soon` : `${t.name} is overdue`, `Deadline: ${due.toLocaleString('en-NG', { timeZone: tz })}`);
      if (phase === 'overdue' && r.sup_user) await ins(r.sup_user, `${r.full_name}'s ${t.name} is overdue`, 'No submission has been received for this period.');
    }
  }
  return sent;
}

export const canOversee = (c: Ctx) => can(c.subject, 'report:oversee').allow;
