import { markAttempt, parseQuestions, pickQuestions, type ParsedQuestion, type ParseIssue } from '../domain/questions';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import { extractText } from './docs-extract';
import type { Q } from './db';
import { computeCard } from './kpi';
import { notify } from './hr';

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const okPeriod = (p: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
const today = () => new Date().toISOString().slice(0, 10);

// ---- Question banks (Super Admin / Administrator) ------------------------------------------------------------------------------------------------------
export interface Preview { kind: string; questions: ParsedQuestion[]; issues: ParseIssue[]; textLength: number }

/** Reads an uploaded Word/PDF/PowerPoint file and shows what would be imported. Nothing is saved. */
export async function previewUpload(c: Ctx, data: Buffer): Promise<Preview> {
  need(c, 'assessment:manage');
  let ex;
  try { ex = await extractText(data); } catch (e) { throw new UserError((e as Error).message); }
  const { questions, issues } = parseQuestions(ex.text);
  if (!questions.length && !issues.length) issues.push({ line: 1, message: 'No questions were found. Put each question on its own line, the options below it (A. B. C. D.), and * in front of the correct option.' });
  return { kind: ex.kind, questions, issues, textLength: ex.text.length };
}

const validQuestion = (q: any): q is ParsedQuestion =>
  q && typeof q.text === 'string' && q.text.length >= 3 && q.text.length <= 1000 && Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 8
  && q.options.every((o: any) => o && typeof o.key === 'string' && /^[A-H]$/.test(o.key) && typeof o.text === 'string' && o.text.length > 0 && o.text.length <= 500)
  && new Set(q.options.map((o: any) => o.key)).size === q.options.length && q.options.some((o: any) => o.key === q.correctKey);

export async function importBank(c: Ctx, i: { name: string; category: string; source?: string; questions: ParsedQuestion[] }) {
  need(c, 'assessment:manage');
  const name = i.name.trim();
  if (name.length < 2 || name.length > 160) throw new UserError('Give the question bank a name.');
  if (!['product', 'service', 'mixed'].includes(i.category)) throw new UserError('Choose product, service or mixed.');
  if (!Array.isArray(i.questions) || i.questions.length === 0) throw new UserError('There are no valid questions to import.');
  if (i.questions.length > 300 || !i.questions.every(validQuestion)) throw new UserError('Some questions are not valid. Upload the file again and check the preview.');
  const b = (await c.q.query<{ id: string }>('insert into assessment_banks (org_id, name, category, source_file, question_count, created_by) values ($1,$2,$3,$4,$5,$6) returning id', [c.orgId, name, i.category, i.source?.slice(0, 200) || null, i.questions.length, c.userId]))[0];
  let pos = 0;
  for (const q of i.questions) await c.q.query('insert into assessment_questions (org_id, bank_id, position, text, options, correct_key) values ($1,$2,$3,$4,$5::jsonb,$6)', [c.orgId, b.id, ++pos, q.text.trim(), JSON.stringify(q.options.map((o) => ({ key: o.key, text: o.text.trim() }))), q.correctKey]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'assessment.bank_imported', entity: 'assessment_bank', entityId: b.id, after: { name, questions: i.questions.length, source: i.source }, ip: c.ip, userAgent: c.userAgent });
  return { id: b.id, count: i.questions.length };
}

export async function listBanks(c: Ctx) {
  need(c, 'assessment:manage');
  return c.q.query<any>(`select b.id, b.name, b.category, b.source_file, b.question_count, b.active, b.created_at, u.email as by from assessment_banks b left join users u on u.id = b.created_by order by b.created_at desc`);
}
export async function bankQuestions(c: Ctx, bankId: string) {
  need(c, 'assessment:manage');
  return c.q.query<any>('select id, position, text, options, correct_key from assessment_questions where bank_id = $1 order by position', [bankId]);
}
export async function setBankActive(c: Ctx, bankId: string, active: boolean) {
  need(c, 'assessment:manage');
  const r = await c.q.query('update assessment_banks set active = $2 where id = $1 returning id', [bankId, active]);
  if (!r[0]) throw new UserError('Question bank not found.');
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: active ? 'assessment.bank_enabled' : 'assessment.bank_disabled', entity: 'assessment_bank', entityId: bankId, ip: c.ip, userAgent: c.userAgent });
}
export async function deleteQuestion(c: Ctx, questionId: string) {
  need(c, 'assessment:manage');
  const q = (await c.q.query<any>('delete from assessment_questions where id = $1 returning bank_id', [questionId]))[0];
  if (!q) throw new UserError('Question not found.');
  await c.q.query('update assessment_banks set question_count = (select count(*) from assessment_questions where bank_id = $1) where id = $1', [q.bank_id]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'assessment.question_deleted', entity: 'assessment_question', entityId: questionId, ip: c.ip, userAgent: c.userAgent });
}

// ---- Scheduling ------------------------------------------------------------------------------------------------------------------------------------------------
export async function scheduleAssessment(c: Ctx, i: { period: string; title?: string; count: number; passMark: number; minutes: number; opensOn: string; closesOn: string; bankIds: string[] }) {
  need(c, 'assessment:manage');
  if (!okPeriod(i.period)) throw new UserError('Choose the month this assessment counts for.');
  if (!isDate(i.opensOn) || !isDate(i.closesOn) || i.closesOn < i.opensOn) throw new UserError('Enter valid opening and closing dates.');
  if (!(Number.isInteger(i.count) && i.count >= 1 && i.count <= 100)) throw new UserError('Choose between 1 and 100 questions.');
  if (!(Number.isInteger(i.passMark) && i.passMark >= 1 && i.passMark <= 100)) throw new UserError('The pass mark must be between 1 and 100.');
  if (!(Number.isInteger(i.minutes) && i.minutes >= 5 && i.minutes <= 240)) throw new UserError('The time limit must be between 5 and 240 minutes.');
  if (!i.bankIds.length) throw new UserError('Choose at least one question bank.');
  const banks = await c.q.query<{ id: string; n: number }>(`select b.id, (select count(*)::int from assessment_questions q where q.bank_id = b.id) n from assessment_banks b where b.id = any($1::uuid[]) and b.active`, [i.bankIds]);
  if (banks.length !== i.bankIds.length) throw new UserError('One of the chosen question banks is missing or switched off.');
  const pool = banks.reduce((a, b) => a + b.n, 0);
  if (pool < i.count) throw new UserError(`The chosen banks hold only ${pool} question(s), but you asked for ${i.count} per person.`);
  if ((await c.q.query('select 1 from assessments where period = $1', [i.period]))[0]) throw new UserError(`An assessment for ${i.period} already exists.`);
  const title = i.title?.trim() || `Product & service knowledge: ${i.period}`;
  const a = (await c.q.query<{ id: string }>('insert into assessments (org_id, period, title, question_count, pass_mark, minutes, opens_on, closes_on, bank_ids, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) returning id', [c.orgId, i.period, title, i.count, i.passMark, i.minutes, i.opensOn, i.closesOn, JSON.stringify(i.bankIds), c.userId]))[0];
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'assessment.scheduled', entity: 'assessment', entityId: a.id, after: { period: i.period, count: i.count, opensOn: i.opensOn, closesOn: i.closesOn }, ip: c.ip, userAgent: c.userAgent });
  return a.id;
}

const status = (a: { opens_on: string; closes_on: string }) => (today() < a.opens_on ? 'upcoming' : today() > a.closes_on ? 'closed' : 'open');

export async function listAssessments(c: Ctx) {
  need(c, 'assessment:take');
  const emp = c.subject.employeeId;
  const rows = await c.q.query<any>(`select a.id, a.period, a.title, a.question_count, a.pass_mark, a.minutes, a.opens_on::text as opens_on, a.closes_on::text as closes_on,
      t.status as attempt_status, t.score_pct, t.correct, t.total, t.submitted_at
    from assessments a left join assessment_attempts t on t.assessment_id = a.id and t.employee_id = $1 order by a.period desc limit 24`, [emp]);
  return rows.map((r) => ({ ...r, state: status(r), score: r.score_pct == null ? null : Number(r.score_pct), passed: r.score_pct == null ? null : Number(r.score_pct) >= r.pass_mark }));
}

// ---- Taking an assessment --------------------------------------------------------------------------------------------------------------------------------
export interface TakeView { id: string; title: string; minutes: number; passMark: number; deadlineAt: string; questions: { id: string; text: string; options: { key: string; text: string }[] }[] }

/** Starts (or resumes) the person's single attempt. The correct answers never leave the server. */
export async function startAttempt(c: Ctx, assessmentId: string): Promise<TakeView> {
  need(c, 'assessment:take');
  const emp = c.subject.employeeId;
  if (!emp) throw new UserError('Your login is not linked to an employee record. Ask HR to link it.');
  const a = (await c.q.query<any>(`select id, title, question_count, pass_mark, minutes, opens_on::text as opens_on, closes_on::text as closes_on, bank_ids from assessments where id = $1`, [assessmentId]))[0];
  if (!a) throw new UserError('Assessment not found.');
  if (status(a) !== 'open') throw new UserError(status(a) === 'upcoming' ? `This assessment opens on ${a.opens_on}.` : 'This assessment has closed.');
  await c.q.query('select id from employees where id = $1 for update', [emp]); // one attempt at a time per person
  let att = (await c.q.query<any>('select * from assessment_attempts where assessment_id = $1 and employee_id = $2', [assessmentId, emp]))[0];
  if (att?.status === 'submitted') throw new UserError('You have already taken this assessment. Your result is below.');
  if (!att) {
    const pool = await c.q.query<{ id: string }>(`select q.id from assessment_questions q join assessment_banks b on b.id = q.bank_id where b.active and q.bank_id = any($1::uuid[])`, [a.bank_ids]);
    const picked = pickQuestions(pool, a.question_count, `${emp}:${assessmentId}`).map((q) => q.id);
    if (picked.length === 0) throw new UserError('This assessment has no questions. Tell your administrator.');
    att = (await c.q.query<any>(`insert into assessment_attempts (org_id, assessment_id, employee_id, question_ids) values ($1,$2,$3,$4::jsonb) returning *`, [c.orgId, assessmentId, emp, JSON.stringify(picked)]))[0];
  }
  const deadline = new Date(new Date(att.started_at).getTime() + a.minutes * 60_000);
  if (Date.now() > deadline.getTime() + 120_000) { await finishAttempt(c, att, {}); throw new UserError('Your time ran out before you submitted, so the attempt was closed.'); }
  const ids: string[] = att.question_ids;
  const qs = await c.q.query<any>('select id, text, options from assessment_questions where id = any($1::uuid[])', [ids]);
  const byId = new Map(qs.map((q) => [q.id, q]));
  return { id: a.id, title: a.title, minutes: a.minutes, passMark: a.pass_mark, deadlineAt: deadline.toISOString(), questions: ids.filter((x) => byId.has(x)).map((x) => ({ id: x, text: byId.get(x).text, options: byId.get(x).options })) };
}

async function finishAttempt(c: Ctx, att: any, answers: Record<string, string>) {
  const ids: string[] = att.question_ids;
  const keys = await c.q.query<{ id: string; correct_key: string }>('select id, correct_key from assessment_questions where id = any($1::uuid[])', [ids]);
  const correct = Object.fromEntries(keys.map((k) => [k.id, k.correct_key]));
  const m = markAttempt(correct, answers);
  await c.q.query(`update assessment_attempts set status = 'submitted', submitted_at = now(), answers = $2::jsonb, correct = $3, total = $4, score_pct = $5 where id = $1`, [att.id, JSON.stringify(answers), m.correct, ids.length, m.pct]);
  return m;
}

export async function submitAttempt(c: Ctx, assessmentId: string, rawAnswers: Record<string, string>) {
  need(c, 'assessment:take');
  const emp = c.subject.employeeId;
  if (!emp) throw new UserError('Your login is not linked to an employee record.');
  await c.q.query('select id from employees where id = $1 for update', [emp]);
  const att = (await c.q.query<any>('select * from assessment_attempts where assessment_id = $1 and employee_id = $2', [assessmentId, emp]))[0];
  if (!att) throw new UserError('Start the assessment first.');
  if (att.status === 'submitted') throw new UserError('You have already submitted this assessment.');
  const a = (await c.q.query<any>('select period, pass_mark, minutes from assessments where id = $1', [assessmentId]))[0];
  const ids: string[] = att.question_ids;
  const answers: Record<string, string> = {};
  for (const id of ids) if (typeof rawAnswers[id] === 'string' && /^[A-H]$/.test(rawAnswers[id])) answers[id] = rawAnswers[id]; // only answers to questions this person was given
  const late = Date.now() > new Date(att.started_at).getTime() + a.minutes * 60_000 + 120_000;
  const m = await finishAttempt(c, att, late ? {} : answers);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'assessment.submitted', entity: 'assessment', entityId: assessmentId, after: { score: m.pct, late }, ip: c.ip, userAgent: c.userAgent });
  await computeCard(c.q, c.orgId, emp, a.period); // the KPI picks the score up straight away
  return { ...m, passed: m.pct >= a.pass_mark, late };
}

/** After submitting: what the person answered and what was right. Never available before submission. */
export async function myReview(c: Ctx, assessmentId: string) {
  need(c, 'assessment:take');
  const emp = c.subject.employeeId;
  const att = emp ? (await c.q.query<any>(`select * from assessment_attempts where assessment_id = $1 and employee_id = $2 and status = 'submitted'`, [assessmentId, emp]))[0] : null;
  if (!att) return null;
  const a = (await c.q.query<any>('select title, pass_mark from assessments where id = $1', [assessmentId]))[0];
  const qs = await c.q.query<any>('select id, text, options, correct_key from assessment_questions where id = any($1::uuid[])', [att.question_ids]);
  const byId = new Map(qs.map((q) => [q.id, q]));
  const answers = att.answers as Record<string, string>;
  return { title: a.title, passMark: a.pass_mark, pct: Number(att.score_pct), correct: att.correct, total: att.total, items: (att.question_ids as string[]).filter((id) => byId.has(id)).map((id) => { const q = byId.get(id); return { text: q.text, options: q.options, chosen: answers[id] ?? null, correctKey: q.correct_key }; }) };
}

// ---- Results for managers --------------------------------------------------------------------------------------------------------------------------------
export async function assessmentResults(c: Ctx, assessmentId: string) {
  need(c, 'assessment:manage');
  const a = (await c.q.query<any>('select id, title, period, pass_mark, question_count from assessments where id = $1', [assessmentId]))[0];
  if (!a) throw new UserError('Assessment not found.');
  const rows = await c.q.query<any>(`select e.id as employee_id, e.full_name, e.employee_no, d.name as department, t.status, t.score_pct, t.correct, t.total, t.submitted_at
    from employees e left join assignments x on x.employee_id = e.id and x.superseded_at is null and x.kind = 'substantive' and x.valid_from <= current_date and (x.valid_to is null or x.valid_to > current_date)
    left join departments d on d.id = x.department_id left join assessment_attempts t on t.assessment_id = $1 and t.employee_id = e.id
    where e.status <> 'exited' and not e.hidden order by d.name nulls last, e.full_name`, [assessmentId]);
  return { assessment: a, rows: rows.map((r) => ({ ...r, score: r.score_pct == null ? null : Number(r.score_pct), passed: r.score_pct == null ? null : Number(r.score_pct) >= a.pass_mark })) };
}

/** Lets someone retake (for example after a technical problem). Their old result is removed from the KPI. */
export async function resetAttempt(c: Ctx, assessmentId: string, employeeId: string) {
  need(c, 'assessment:manage');
  const a = (await c.q.query<any>('select period from assessments where id = $1', [assessmentId]))[0];
  const r = await c.q.query('delete from assessment_attempts where assessment_id = $1 and employee_id = $2 returning id', [assessmentId, employeeId]);
  if (!r[0]) throw new UserError('That person has not started this assessment.');
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'assessment.attempt_reset', entity: 'employee', entityId: employeeId, after: { assessmentId }, ip: c.ip, userAgent: c.userAgent });
  if (a) await computeCard(c.q, c.orgId, employeeId, a.period);
}

/** Cron: remind people who have not taken an open assessment on its first day and in the last three days. */
export async function assessmentReminders(q: Q, orgId: string): Promise<number> {
  const open = await q.query<any>(`select id, title, opens_on::text as opens_on, closes_on::text as closes_on from assessments where opens_on <= current_date and closes_on >= current_date`);
  let n = 0;
  for (const a of open) {
    const daysLeft = Math.round((Date.parse(a.closes_on) - Date.parse(today())) / 86_400_000);
    const stage = a.opens_on === today() ? 'open' : daysLeft <= 3 ? `d${daysLeft}` : null;
    if (!stage) continue;
    const people = await q.query<{ user_id: string }>(`select e.user_id from employees e where e.user_id is not null and e.status = 'active' and not e.hidden and not exists (select 1 from assessment_attempts t where t.assessment_id = $1 and t.employee_id = e.id and t.status = 'submitted')`, [a.id]);
    for (const p of people) {
      const x = await q.query(`insert into notifications (org_id, user_id, title, body, href, dedupe_key) values ($1,$2,$3,$4,'/assessment',$5) on conflict do nothing returning id`,
        [orgId, p.user_id, stage === 'open' ? `Monthly assessment is open: ${a.title}` : `Assessment closes in ${daysLeft} day(s): ${a.title}`, `Closes on ${a.closes_on}. It counts towards your KPI.`, `assess:${a.id}:${stage}:${p.user_id}`]);
      if (x[0]) n++;
    }
  }
  void notify;
  return n;
}
