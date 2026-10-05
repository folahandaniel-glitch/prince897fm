import { beforeAll, describe, expect, it } from 'vitest';
import { privileged, withTenant } from '../src/server/db';
import { seedOrganization, TEMPLATES } from '../src/server/seed';
import { runAs } from '../src/server/ctx';
import { ForbiddenError } from '../src/domain/policy';
import { compliance, decideReport, myReports, reviewQueue, saveTemplate, sendReportReminders, submitReport } from '../src/server/reports';
import { addComment, assignableEmployees, createProject, createTask, getTask, listTasks, setTaskStatus } from '../src/server/tasks';
import { departmentDetail, overview } from '../src/server/executive';
import { search } from '../src/server/search';
import { transferEmployee } from '../src/server/hr';

const ids: Record<string, string> = {};
const u: Record<string, string> = {};
const as = <T>(who: string, fn: Parameters<typeof runAs<T>>[2]) => runAs(ids.org, u[who], fn);

beforeAll(async () => {
  const lines: string[] = [];
  for (const t of TEMPLATES) await seedOrganization(t, lines);
  const p = await privileged();
  ids.org = (await p.query<any>(`select id from organizations where slug = 'prince897'`))[0].id;
  ids.church = (await p.query<any>(`select id from organizations where slug = 'gracechapel'`))[0].id;
  for (const n of ['admin', 'hr', 'presenter', 'chairman', 'head']) u[n] = (await p.query<any>(`select u.id from users u join organizations o on o.id=u.org_id where o.slug='prince897' and u.email=$1`, [`${n}@prince897.example`]))[0].id;
});

describe('reports: submit, snapshot, chained approval', () => {
  let weekly: any, monthly: any;
  it('creates the current period drafts from the seeded templates', async () => {
    const list = await as('presenter', (c) => myReports(c));
    weekly = list.find((r) => r.name === 'Weekly report'); monthly = list.find((r) => r.name === 'Monthly report');
    expect(weekly.status).toBe('draft');
    expect(monthly.cadence).toBe('monthly');
    expect((await as('presenter', (c) => myReports(c))).length).toBe(list.length); // idempotent: no duplicate periods
  });
  it('requires required answers before submitting; saves drafts without them', async () => {
    await expect(as('presenter', (c) => submitReport(c, weekly.id, { work_done: 'x' }, true))).rejects.toThrow(/Plans for next period/);
    expect((await as('presenter', (c) => submitReport(c, weekly.id, { work_done: 'half' }, false))).message).toMatch(/Draft saved/);
  });
  it('submits, freezing department and supervisor, and routes to the supervisor first', async () => {
    const r = await as('presenter', (c) => submitReport(c, weekly.id, { work_done: 'Bulletins', next_plans: 'More bulletins' }, true));
    expect(r.status).toBe('submitted');
    const row = (await withTenant(ids.org, (q) => q.query<any>('select ctx_department, ctx_supervisor, step from reports where id = $1', [weekly.id])))[0];
    expect(row.ctx_department).toBe('News');
    expect(row.ctx_supervisor).toMatch(/Head of News/);
    expect(row.step).toBe(0);
    await expect(as('presenter', (c) => submitReport(c, weekly.id, { work_done: 'edit', next_plans: 'edit' }, true))).rejects.toThrow(/no longer be edited/);
  });
  it('only the recorded supervisor sees it at stage 1; nobody can review their own', async () => {
    expect((await as('head', (c) => reviewQueue(c))).map((x) => x.id)).toContain(weekly.id);
    expect((await as('hr', (c) => reviewQueue(c))).map((x) => x.id)).not.toContain(weekly.id);
    expect((await as('chairman', (c) => reviewQueue(c))).map((x) => x.id)).not.toContain(weekly.id);
    await expect(as('presenter', (c) => reviewQueue(c))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('hr', (c) => decideReport(c, weekly.id, 'approved', ''))).rejects.toThrow(/not at your approval stage/);
  });
  it('supervisor approves, executive completes; one person cannot hold two stages', async () => {
    expect(await as('head', (c) => decideReport(c, weekly.id, 'approved', 'Good'))).toBe('under_review');
    await expect(as('head', (c) => decideReport(c, weekly.id, 'approved', ''))).rejects.toThrow();
    expect((await as('chairman', (c) => reviewQueue(c))).map((x) => x.id)).toContain(weekly.id);
    expect(await as('chairman', (c) => decideReport(c, weekly.id, 'approved', ''))).toBe('approved');
    const reviews = await withTenant(ids.org, (q) => q.query<any>('select step, decision from report_reviews where report_id = $1 order by id', [weekly.id]));
    expect(reviews.map((r) => r.decision)).toEqual(['approved', 'approved']);
    await expect(withTenant(ids.org, (q) => q.query('delete from report_reviews'))).rejects.toThrow(); // decisions are evidence
  });
  it('returning needs a reason, resets to the first stage and allows resubmission', async () => {
    await as('presenter', (c) => submitReport(c, monthly.id, { work_done: 'A', next_plans: 'B' }, true));
    await expect(as('head', (c) => decideReport(c, monthly.id, 'returned', ''))).rejects.toThrow(/explain/);
    expect(await as('head', (c) => decideReport(c, monthly.id, 'returned', 'Add the figures'))).toBe('returned');
    expect((await as('presenter', (c) => submitReport(c, monthly.id, { work_done: 'A+', next_plans: 'B' }, true))).status).toBe('submitted');
  });
  it('history keeps the original department and supervisor after a transfer', async () => {
    const emp = (await withTenant(ids.org, (q) => q.query<any>('select id from employees where user_id = $1', [u.presenter])))[0].id;
    const prod = (await withTenant(ids.org, (q) => q.query<any>(`select id from departments where name = 'Production'`)))[0].id;
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await as('hr', (c) => transferEmployee(c, { employeeId: emp, departmentId: prod, effectiveFrom: tomorrow, reason: 'Restructure' }));
    const row = (await withTenant(ids.org, (q) => q.query<any>('select ctx_department, ctx_supervisor from reports where id = $1', [weekly.id])))[0];
    expect(row.ctx_department).toBe('News');
    expect(row.ctx_supervisor).toMatch(/Head of News/);
  });
  it('templates: admin/HR manage them, employees cannot; unknown roles are rejected', async () => {
    await expect(as('presenter', (c) => saveTemplate(c, { name: 'Hack', cadence: 'weekly', dueTime: '18:00', fields: [{ label: 'x', type: 'text', required: true }], chain: [] }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('hr', (c) => saveTemplate(c, { name: 'Bad chain', cadence: 'weekly', dueTime: '18:00', fields: [{ label: 'x', type: 'text', required: true }], chain: [{ kind: 'role', roleKey: 'nope' }] }))).rejects.toThrow(/Unknown role/);
    await as('hr', (c) => saveTemplate(c, { name: 'Always overdue', cadence: 'weekly', dueWeekday: 1, dueTime: '00:00', fields: [{ label: 'Notes', type: 'text', required: false }], chain: [{ kind: 'supervisor' }] }));
  });
  it('compliance for oversight roles lists who is missing; reminders are sent once', async () => {
    const k = await as('chairman', (c) => compliance(c));
    expect(k.length).toBeGreaterThanOrEqual(3);
    expect(k.find((x) => x.template === 'Always overdue')!.missing.some((m: any) => m.overdue)).toBe(true);
    await expect(as('presenter', (c) => compliance(c))).rejects.toBeInstanceOf(ForbiddenError);
    const first = await withTenant(ids.org, (q) => sendReportReminders(q, ids.org));
    const second = await withTenant(ids.org, (q) => sendReportReminders(q, ids.org));
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
    const note = await withTenant(ids.org, (q) => q.query<any>(`select title from notifications where user_id = $1 and title like '%overdue%'`, [u.presenter]));
    expect(note.length).toBeGreaterThan(0);
  });
});

describe('tasks', () => {
  let taskId = '';
  it('anyone can create their own task, but assigning others needs permission', async () => {
    taskId = await as('presenter', (c) => createTask(c, { title: 'Prepare Sunday programme', dueDate: '2030-01-01', priority: 'high' }));
    const hrEmp = (await withTenant(ids.org, (q) => q.query<any>('select id from employees where user_id = $1', [u.hr])))[0].id;
    await expect(as('presenter', (c) => createTask(c, { title: 'Do my work', assigneeId: hrEmp }))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await as('presenter', (c) => assignableEmployees(c))).length).toBe(0);
  });
  it('managers assign work and the assignee is notified; only people involved can see it', async () => {
    const presEmp = (await withTenant(ids.org, (q) => q.query<any>('select id from employees where user_id = $1', [u.presenter])))[0].id;
    await as('head', (c) => createProject(c, 'Anniversary broadcast'));
    const id = await as('head', (c) => createTask(c, { title: 'Record station IDs', assigneeId: presEmp, priority: 'urgent' }));
    const n = await withTenant(ids.org, (q) => q.query<any>(`select title from notifications where user_id = $1 and title like 'New task%'`, [u.presenter]));
    expect(n.length).toBe(1);
    expect((await as('presenter', (c) => listTasks(c, 'mine'))).map((t) => t.id)).toContain(id);
    await expect(as('hr', (c) => getTask(c, taskId))).resolves.toBeTruthy(); // HR holds task:assign
    await expect(as('admin', (c) => getTask(c, taskId))).resolves.toBeTruthy();
  });
  it('assignee updates status; comments notify; subtasks only under top-level tasks', async () => {
    await as('presenter', (c) => setTaskStatus(c, taskId, 'in_progress'));
    await as('presenter', (c) => addComment(c, taskId, 'Started'));
    const sub = await as('presenter', (c) => createTask(c, { title: 'Outline', parentId: taskId }));
    await expect(as('presenter', (c) => createTask(c, { title: 'Nested', parentId: sub }))).rejects.toThrow(/top-level/);
    await expect(as('presenter', (c) => setTaskStatus(c, taskId, 'bogus'))).rejects.toThrow(/Unknown status/);
    const t = await as('presenter', (c) => getTask(c, taskId));
    expect(t!.comments.length).toBe(1);
    expect(t!.subtasks.length).toBe(1);
  });
  it('team view requires task:assign', async () => {
    await expect(as('presenter', (c) => listTasks(c, 'team'))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await as('hr', (c) => listTasks(c, 'team'))).length).toBeGreaterThan(0);
  });
});

describe('executive command centre and search', () => {
  it('shows organisation-wide indicators to executives only and logs each view', async () => {
    const o = await as('chairman', (c) => overview(c));
    expect(o.people.total).toBeGreaterThan(3);
    expect(Array.isArray(o.alerts)).toBe(true);
    await expect(as('presenter', (c) => overview(c))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('hr', (c) => overview(c))).rejects.toBeInstanceOf(ForbiddenError); // HR is not an executive grant
    const dept = o.byDept[0];
    const d = await as('chairman', (c) => departmentDetail(c, dept.id));
    expect(d.people.length).toBeGreaterThan(0);
    const logged = await withTenant(ids.org, (q) => q.query<any>(`select action from audit_events where action in ('executive.viewed','executive.drilldown')`));
    expect(logged.map((l) => l.action)).toEqual(expect.arrayContaining(['executive.viewed', 'executive.drilldown']));
  });
  it('search respects permissions', async () => {
    const hrHits = await as('hr', (c) => search(c, 'presenter'));
    expect(hrHits.some((h) => h.kind === 'Employee')).toBe(true);
    const empHits = await as('presenter', (c) => search(c, 'presenter'));
    expect(empHits.some((h) => h.kind === 'Employee')).toBe(false);
    const mine = await as('presenter', (c) => search(c, 'sunday'));
    expect(mine.some((h) => h.kind === 'Task')).toBe(true);
  });
  it('another organisation sees none of it', async () => {
    for (const t of ['reports', 'tasks', 'report_templates']) {
      expect((await withTenant(ids.church, (q) => q.query<any>(`select count(*)::int c from ${t}`)))[0].c).toBe(0);
    }
  });
});
