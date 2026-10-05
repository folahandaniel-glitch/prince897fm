import { can } from '../domain/policy';
import { parseMoney, toDb, fromDb, MoneyError } from '../domain/finance';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import type { Q } from './db';
import { notify } from './hr';

const CUR = `a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)`;
export const KINDS = ['query', 'verbal_warning', 'written_warning', 'final_warning', 'suspension', 'fine', 'commendation'] as const;
const SANCTIONS = ['written_warning', 'final_warning', 'suspension', 'fine'];
const WARNINGS = ['verbal_warning', 'written_warning', 'final_warning'];
export const KIND_LABEL: Record<string, string> = { query: 'Query (show cause)', verbal_warning: 'Verbal warning', written_warning: 'Written warning', final_warning: 'Final written warning', suspension: 'Suspension', fine: 'Fine', commendation: 'Commendation' };

/** Starter rule library. References are deliberately generic: HR must complete the exact clause numbers and have counsel confirm them. */
export const DEFAULT_RULES: { code: string; title: string; category: string; description: string; reference: string; guidance: string; action: string }[] = [
  { code: 'LATE', title: 'Lateness and punctuality', category: 'Attendance', description: 'Repeated late arrival without approval.', reference: 'Employment contract / staff handbook: working hours clause (add clause number).', guidance: 'Check the attendance record and whether an explanation was approved. Start with a verbal warning; use a written query before any fine or written warning.', action: 'verbal_warning' },
  { code: 'ABS', title: 'Absence without leave', category: 'Attendance', description: 'Absent on rostered days without approved leave or a reviewed explanation.', reference: 'Employment contract / staff handbook: attendance and leave clause (add clause number).', guidance: 'Confirm no leave or exception was approved. Issue a written query and give the employee a fair chance to explain before deciding.', action: 'written_warning' },
  { code: 'INSUB', title: 'Insubordination', category: 'Conduct', description: 'Wilful refusal to follow a lawful and reasonable instruction.', reference: 'Staff handbook: conduct clause (add clause number).', guidance: 'Record the exact instruction, who gave it, and the response. Query first; never sanction without hearing the employee.', action: 'written_warning' },
  { code: 'NEGL', title: 'Negligence and carelessness', category: 'Performance', description: 'Failure to take reasonable care resulting in loss, damage or on-air error.', reference: 'Staff handbook: duty of care / broadcast standards (add clause number).', guidance: 'Describe the impact. Distinguish a first honest mistake (coaching or verbal warning) from repeated negligence.', action: 'verbal_warning' },
  { code: 'DISH', title: 'Dishonesty, fraud or theft', category: 'Serious misconduct', description: 'Dishonest conduct involving money, property or records.', reference: 'Staff handbook: serious misconduct (add clause). Labour Act (Cap L1, LFN 2004) and criminal law may apply: take legal advice.', guidance: 'Preserve evidence, query in writing, allow a full response, and involve a senior executive and counsel before any suspension, dismissal or police referral.', action: 'suspension' },
  { code: 'HARASS', title: 'Harassment or abusive behaviour', category: 'Serious misconduct', description: 'Harassment, bullying, discrimination or violence at work.', reference: 'Staff handbook: dignity at work (add clause). Take legal advice.', guidance: 'Protect the complainant, keep records confidential, and follow the formal investigation steps in your policy before any decision.', action: 'suspension' },
  { code: 'SAFE', title: 'Safety and equipment misuse', category: 'Safety', description: 'Breach of safety rules or misuse of studio, transmitter or other equipment.', reference: 'Staff handbook: health and safety (add clause).', guidance: 'Record the equipment and risk. Treat endangering others as serious; otherwise start with a written query.', action: 'written_warning' },
  { code: 'COMM', title: 'Commendation / exceptional work', category: 'Recognition', description: 'Recognise outstanding performance or conduct.', reference: 'Recognition policy.', guidance: 'Be specific about what was done and its impact.', action: 'commendation' },
];

export async function seedRules(q: Q, orgId: string) {
  for (const r of DEFAULT_RULES) await q.query('insert into discipline_rules (org_id, code, title, category, description, reference, guidance, default_action) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing', [orgId, r.code, r.title, r.category, r.description, r.reference, r.guidance, r.action]);
}

export async function listRules(q: Q, activeOnly = true) {
  return q.query<any>(`select * from discipline_rules ${activeOnly ? 'where active' : ''} order by category, title`);
}

export async function saveRule(c: Ctx, i: { id?: string; code: string; title: string; category: string; description: string; reference: string; guidance: string; defaultAction?: string; active?: boolean }) {
  need(c, 'discipline:manage');
  if (!/^[A-Z0-9_]{2,12}$/.test(i.code.trim().toUpperCase())) throw new UserError('Use a short code of letters and numbers, e.g. LATE.');
  if (i.title.trim().length < 3 || i.description.trim().length < 5) throw new UserError('Add a title and a description.');
  if (i.id) {
    await c.q.query('update discipline_rules set title = $2, category = $3, description = $4, reference = $5, guidance = $6, default_action = $7, active = $8 where id = $1', [i.id, i.title.trim(), i.category.trim(), i.description.trim(), i.reference.trim(), i.guidance.trim(), i.defaultAction || null, i.active ?? true]);
  } else {
    if ((await c.q.query('select 1 from discipline_rules where code = $1', [i.code.trim().toUpperCase()]))[0]) throw new UserError('That code is already used.');
    await c.q.query('insert into discipline_rules (org_id, code, title, category, description, reference, guidance, default_action) values ($1,$2,$3,$4,$5,$6,$7,$8)', [c.orgId, i.code.trim().toUpperCase(), i.title.trim(), i.category.trim(), i.description.trim(), i.reference.trim(), i.guidance.trim(), i.defaultAction || null]);
  }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: i.id ? 'discipline.rule_updated' : 'discipline.rule_created', entity: 'discipline_rule', entityId: i.id ?? i.code, after: { title: i.title, reference: i.reference }, ip: c.ip, userAgent: c.userAgent });
}

async function nextNumber(q: Q, orgId: string) {
  await q.query('select pg_advisory_xact_lock(hashtext($1))', [`dsc:${orgId}`]);
  const r = await q.query<{ n: number }>(`select coalesce(max(substring(number from '[0-9]+$')::int), 0) + 1 as n from discipline_cases`);
  return `DSC-${String(r[0].n).padStart(5, '0')}`;
}

async function empScope(q: Q, employeeId: string) {
  const e = (await q.query<any>(`select e.id, e.full_name, e.user_id, a.department_id, a.branch_id from employees e left join assignments a on a.employee_id = e.id and ${CUR} where e.id = $1`, [employeeId]))[0];
  if (!e) throw new UserError('Unknown employee.');
  return e as { id: string; full_name: string; user_id: string | null; department_id: string | null; branch_id: string | null };
}

export interface RaiseInput { employeeId: string; kind: string; ruleId?: string | null; title: string; facts: string; incidentDate: string; responseHours?: number; basisCaseId?: string | null; overrideReason?: string; fineAmount?: string; fineMonth?: string }

export async function raiseCase(c: Ctx, i: RaiseInput) {
  const emp = await empScope(c.q, i.employeeId);
  need(c, 'discipline:raise', { departmentId: emp.department_id, branchId: emp.branch_id });
  if (!(KINDS as readonly string[]).includes(i.kind)) throw new UserError('Choose what you are issuing.');
  if (emp.user_id === c.userId) throw new UserError('You cannot raise a disciplinary matter about yourself.');
  if (i.title.trim().length < 5) throw new UserError('Give the matter a clear title.');
  if (i.facts.trim().length < 20) throw new UserError('Describe the facts in at least a couple of sentences: what happened, when, and the effect. The employee will read this.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.incidentDate)) throw new UserError('Enter the date of the incident.');
  if (i.incidentDate > new Date().toISOString().slice(0, 10)) throw new UserError('The incident date cannot be in the future.');
  if (i.ruleId && !(await c.q.query('select 1 from discipline_rules where id = $1 and active', [i.ruleId]))[0]) throw new UserError('Unknown rule.');
  // Fair hearing: serious sanctions follow a query that the employee has had a chance to answer.
  let basis: any = null;
  if (SANCTIONS.includes(i.kind)) {
    if (i.basisCaseId) {
      basis = (await c.q.query<any>(`select * from discipline_cases where id = $1 and employee_id = $2 and kind = 'query'`, [i.basisCaseId, i.employeeId]))[0];
      if (!basis) throw new UserError('Choose a query that was issued to this employee.');
      if (!['responded', 'decided'].includes(basis.status) && !(basis.response_due && new Date(basis.response_due) < new Date())) throw new UserError('The employee is still within the time allowed to respond to that query.');
    } else {
      if (!can(c.subject, 'discipline:decide').allow) throw new UserError('Issue a query first and let the employee respond. A sanction can only be recorded without a query by HR, with a written reason.');
      if ((i.overrideReason ?? '').trim().length < 20) throw new UserError('Explain why no query was issued first (at least 20 characters). This is recorded.');
    }
  }
  const number = await nextNumber(c.q, c.orgId);
  const hours = Math.min(Math.max(i.responseHours ?? 48, 24), 24 * 14);
  const due = i.kind === 'query' ? new Date(Date.now() + hours * 3_600_000) : null;
  const expires = WARNINGS.includes(i.kind) ? new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10) : null;
  let fine: string | null = null;
  if (i.kind === 'fine') {
    if (!can(c.subject, 'discipline:decide').allow) throw new UserError('Only HR or an executive can record a fine.');
    try { fine = toDb(parseMoney(i.fineAmount ?? '')); } catch (e) { if (e instanceof MoneyError) throw new UserError(e.message); throw e; }
    if (!/^\d{4}-\d{2}$/.test(i.fineMonth ?? '')) throw new UserError('Choose the pay month the fine applies to.');
  }
  const r = await c.q.query<{ id: string }>(
    `insert into discipline_cases (org_id, number, employee_id, kind, rule_id, title, facts, incident_date, response_due, warning_expires_on, fine_amount, fine_period, basis_case_id, override_reason, issued_by, outcome, decided_by, decided_at, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning id`,
    [c.orgId, number, i.employeeId, i.kind, i.ruleId || null, i.title.trim(), i.facts.trim(), i.incidentDate, due, expires, fine, i.fineMonth || null, basis?.id ?? null, i.overrideReason?.trim() || null, c.userId,
      i.kind === 'query' ? null : i.kind, i.kind === 'query' ? null : c.userId, i.kind === 'query' ? null : new Date(), i.kind === 'query' ? 'issued' : 'issued']);
  if (i.kind === 'fine') {
    await c.q.query(`insert into pay_adjustments (org_id, employee_id, period, kind, amount, reason, source_type, source_ref, proposed_by, decided_by, decided_at, status, decision_note) values ($1,$2,$3,'fine',$4,$5,'discipline',$6,$7,$7, now(),'approved',$8)`,
      [c.orgId, i.employeeId, i.fineMonth, fine, `Disciplinary fine ${number}: ${i.title.trim()}`, number, c.userId, 'Recorded with disciplinary case']);
  }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'discipline.raised', entity: 'discipline_case', entityId: r[0].id, after: { number, kind: i.kind, employee: emp.full_name, basis: basis?.number ?? null, override: !!i.overrideReason }, reason: i.overrideReason, ip: c.ip, userAgent: c.userAgent });
  if (emp.user_id) await notify(c.q, c.orgId, emp.user_id, i.kind === 'commendation' ? 'You have received a commendation' : `A disciplinary matter has been recorded: ${KIND_LABEL[i.kind]}`, i.kind === 'query' ? `Please respond before ${due!.toLocaleString('en-NG')}.` : 'Open it to read the details and acknowledge receipt.', `/discipline/${r[0].id}`);
  return { id: r[0].id, number };
}

export async function respond(c: Ctx, id: string, text: string) {
  const x = (await c.q.query<any>('select d.*, e.user_id as emp_user from discipline_cases d join employees e on e.id = d.employee_id where d.id = $1 for update of d', [id]))[0];
  if (!x || x.emp_user !== c.userId) throw new UserError('Case not found.');
  need(c, 'discipline:view:own');
  if (text.trim().length < 5) throw new UserError('Write your response.');
  if (!['query'].includes(x.kind) && x.status !== 'issued') throw new UserError('This matter is closed.');
  if (x.kind === 'query' && x.status !== 'issued') throw new UserError('You have already responded to this query.');
  await c.q.query(`update discipline_cases set employee_response = $2, responded_at = now(), status = case when kind = 'query' then 'responded' else status end where id = $1`, [id, text.trim().slice(0, 8000)]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'discipline.responded', entity: 'discipline_case', entityId: id, ip: c.ip, userAgent: c.userAgent });
  await notify(c.q, c.orgId, x.issued_by, 'An employee responded to your query', x.number, `/discipline/${id}`);
}

export async function acknowledge(c: Ctx, id: string) {
  const x = (await c.q.query<any>('select d.*, e.user_id as emp_user from discipline_cases d join employees e on e.id = d.employee_id where d.id = $1 for update of d', [id]))[0];
  if (!x || x.emp_user !== c.userId) throw new UserError('Case not found.');
  if (x.kind === 'query' || x.acknowledged_at) throw new UserError('Nothing to acknowledge.');
  await c.q.query(`update discipline_cases set acknowledged_at = now(), status = 'acknowledged' where id = $1`, [id]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'discipline.acknowledged', entity: 'discipline_case', entityId: id, ip: c.ip, userAgent: c.userAgent });
}

export async function decideQuery(c: Ctx, id: string, i: { outcome: string; note: string }) {
  need(c, 'discipline:decide');
  const x = (await c.q.query<any>('select * from discipline_cases where id = $1 for update', [id]))[0];
  if (!x || x.kind !== 'query' || x.status === 'decided') throw new UserError('This query is not awaiting a decision.');
  if (x.issued_by === c.userId) throw new UserError('Separation of duties: the person who issued the query cannot decide it. Another HR or executive reviewer must.');
  if (x.status === 'issued' && x.response_due && new Date(x.response_due) > new Date()) throw new UserError(`The employee still has until ${new Date(x.response_due).toLocaleString('en-NG')} to respond. A decision cannot be made before then.`);
  if (i.note.trim().length < 20) throw new UserError('Record the reasons for your decision (at least 20 characters), including how the employee\'s response was considered.');
  if (!['no_action', 'verbal_warning', 'written_warning', 'final_warning'].includes(i.outcome)) throw new UserError('Choose an outcome.');
  await c.q.query(`update discipline_cases set status = 'decided', outcome = $2, decision_note = $3, decided_by = $4, decided_at = now() where id = $1`, [id, i.outcome, i.note.trim(), c.userId]);
  const emp = await empScope(c.q, x.employee_id);
  let sanctionNo: string | null = null;
  if (i.outcome !== 'no_action') {
    const number = await nextNumber(c.q, c.orgId);
    await c.q.query(`insert into discipline_cases (org_id, number, employee_id, kind, rule_id, title, facts, incident_date, status, outcome, decision_note, decided_by, decided_at, warning_expires_on, basis_case_id, issued_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,'issued',$4,$9,$10,now(), (current_date + interval '12 months')::date, $11, $10)`, [c.orgId, number, x.employee_id, i.outcome, x.rule_id, x.title, x.facts, x.incident_date, i.note.trim(), c.userId, id]);
    sanctionNo = number;
  }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'discipline.decided', entity: 'discipline_case', entityId: id, after: { outcome: i.outcome, sanction: sanctionNo }, reason: i.note, ip: c.ip, userAgent: c.userAgent });
  if (emp.user_id) await notify(c.q, c.orgId, emp.user_id, 'A decision was made on your query', i.outcome === 'no_action' ? 'No action will be taken.' : `Outcome: ${KIND_LABEL[i.outcome]}.`, `/discipline/${id}`);
}

/** Cases the caller may see: their own, ones they issued, and (with permission) everyone's within scope. */
export async function listCases(c: Ctx, scope: 'mine' | 'all') {
  const rows = await c.q.query<any>(
    `select d.id, d.number, d.kind, d.title, d.status, d.outcome, d.incident_date::text as incident, d.response_due, d.created_at, d.issued_by, d.warning_expires_on::text as expires, e.full_name, e.user_id as emp_user, a.department_id, a.branch_id, r.title as rule
       from discipline_cases d join employees e on e.id = d.employee_id left join assignments a on a.employee_id = e.id and ${CUR} left join discipline_rules r on r.id = d.rule_id order by d.created_at desc limit 300`);
  return rows.filter((r) => {
    if (scope === 'mine') return r.emp_user === c.userId;
    return r.emp_user === c.userId || r.issued_by === c.userId || can(c.subject, 'discipline:view', { departmentId: r.department_id, branchId: r.branch_id }).allow;
  });
}

export async function getCase(c: Ctx, id: string) {
  const x = (await c.q.query<any>(
    `select d.*, d.incident_date::text as incident, e.full_name, e.employee_no, e.user_id as emp_user, a.department_id, a.branch_id, dep.name as department, r.title as rule_title, r.code as rule_code, r.reference as rule_reference, r.guidance as rule_guidance,
            iu.email as issuer, du.email as decider
       from discipline_cases d join employees e on e.id = d.employee_id left join assignments a on a.employee_id = e.id and ${CUR} left join departments dep on dep.id = a.department_id
       left join discipline_rules r on r.id = d.rule_id left join users iu on iu.id = d.issued_by left join users du on du.id = d.decided_by where d.id = $1`, [id]))[0];
  if (!x) return null;
  const own = x.emp_user === c.userId;
  if (!own && x.issued_by !== c.userId) need(c, 'discipline:view', { departmentId: x.department_id, branchId: x.branch_id });
  const active = await c.q.query<any>(`select number, kind, title, warning_expires_on::text as expires from discipline_cases where employee_id = $1 and kind in ('verbal_warning','written_warning','final_warning') and warning_expires_on >= current_date and status <> 'withdrawn' order by created_at desc`, [x.employee_id]);
  const related = await c.q.query<any>(`select id, number, kind, status from discipline_cases where basis_case_id = $1 or id = $2 order by created_at`, [id, x.basis_case_id]);
  return { c: x, own, activeWarnings: active, related, canDecide: can(c.subject, 'discipline:decide').allow && x.issued_by !== c.userId && !own };
}

export const fineFromDb = (v: unknown) => fromDb(v as string);
