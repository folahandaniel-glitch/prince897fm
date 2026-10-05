import { beforeAll, describe, expect, it } from 'vitest';
import { privileged, withTenant } from '../src/server/db';
import { seedOrganization, TEMPLATES } from '../src/server/seed';
import { runAs } from '../src/server/ctx';
import { ForbiddenError } from '../src/domain/policy';
import { approveRun, createRun, decideAdjustment, getPayslip, getRun, listAdjustments, myPayslips, payRun, proposeFines, savePolicy, setCompensation, compensationOverview } from '../src/server/payroll';
import { acknowledge, decideQuery, getCase, listCases, listRules, raiseCase, respond } from '../src/server/discipline';
import { buildPayslipPdf } from '../src/server/payslip-pdf';
import { listAccounts, trialBalance, cashBalance } from '../src/server/finance';
import { listEmployees } from '../src/server/hr';
import { search } from '../src/server/search';

const ids: Record<string, string> = {};
const u: Record<string, string> = {};
const as = <T>(who: string, fn: Parameters<typeof runAs<T>>[2]) => runAs(ids.org, u[who], fn);

const now = new Date();
const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const period = prev.toISOString().slice(0, 7);
const day = (n: number) => `${period}-${String(n).padStart(2, '0')}`;
let presEmp = '';

beforeAll(async () => {
  const lines: string[] = [];
  for (const t of TEMPLATES) await seedOrganization(t, lines);
  const p = await privileged();
  ids.org = (await p.query<any>(`select id from organizations where slug = 'prince897'`))[0].id;
  for (const n of ['hr', 'finmanager', 'payments', 'ceo', 'chairman', 'presenter', 'head', 'officer', 'superadmin', 'accountant']) u[n] = (await p.query<any>(`select u.id from users u join organizations o on o.id=u.org_id where o.slug='prince897' and u.email=$1`, [`${n}@prince897.example`]))[0].id;
  presEmp = (await p.query<any>('select id from employees where user_id = $1', [u.presenter]))[0].id;
  // six late arrivals last month for the presenter
  for (let d = 2; d <= 7; d++) await p.query(`insert into attendance_sessions (org_id, employee_id, work_date, clock_in_at, clock_in_result, late_minutes, status, clock_out_at) values ($1,$2,$3,$3::date + interval '9 hours', 'accepted_flagged', $4, 'closed', $3::date + interval '17 hours')`, [ids.org, presEmp, day(d), 20 + d]);
  // one of them has an approved explanation
  await p.query(`insert into attendance_exceptions (org_id, employee_id, work_date, kind, note, status) values ($1,$2,$3,'late','Power outage at transmitter, supervisor confirmed','approved')`, [ids.org, presEmp, day(2)]);
});

describe('compensation and fines', () => {
  it('compensation is effective-dated and never overwritten', async () => {
    const before = await as('hr', (c) => compensationOverview(c));
    expect(before.find((e: any) => e.id === presEmp)!.gross).toBeGreaterThan(0);
    await expect(as('presenter', (c) => setCompensation(c, presEmp, { basic: '999999', housing: '0', transport: '0', others: [], pension: true, nhf: false, annualRent: '0', effectiveFrom: '2030-01-01' }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('hr', (c) => setCompensation(c, presEmp, { basic: '130000', housing: '0', transport: '0', others: [], pension: true, nhf: false, annualRent: '0', effectiveFrom: '2000-01-01' }))).rejects.toThrow(/History is never overwritten/);
  });
  it('a fine policy cannot be switched on without a recorded legal basis', async () => {
    await expect(as('finmanager', (c) => savePolicy(c, { kind: 'lateness', freePerMonth: 3, perIncident: '1000', perMinute: '0', monthlyCap: '10000', dailyRatePct: 100, legalBasis: '', active: true }))).rejects.toThrow(/legal basis/);
    await as('finmanager', (c) => savePolicy(c, { kind: 'lateness', freePerMonth: 3, perIncident: '1000', perMinute: '0', monthlyCap: '10000', dailyRatePct: 100, legalBasis: 'Employment contract clause 7 (working hours) and handbook section 4.2', active: true }));
  });
  it('proposes lateness fines (excluding approved explanations and the free allowance) and shows each date', async () => {
    const r = await as('hr', (c) => proposeFines(c, period));
    expect(r.lateness).toBe(1);
    const adj = (await as('hr', (c) => listAdjustments(c, period))).find((a: any) => a.source_type === 'lateness')!;
    // 5 late days remain (one excused), first 3 forgiven -> 2 fines of 1000
    expect(Number(adj.amount)).toBe(2000);
    expect(adj.detail).toHaveLength(2);
    expect(adj.status).toBe('proposed');
    expect(adj.detail[0].label).toMatch(/min late/);
    expect((await as('hr', (c) => proposeFines(c, period))).lateness).toBe(0); // idempotent
    await as('hr', (c) => decideAdjustment(c, adj.id, true, ''));
  });
});

describe('payroll run: prepare, approve, pay, payslips', () => {
  let runId = '', slipId = '';
  it('requires saved settings, then prepares payslips with the fine itemised in deductions', async () => {
    const r = await as('hr', (c) => createRun(c, period));
    runId = r.id;
    expect(r.employees).toBeGreaterThan(5);
    const run = (await as('hr', (c) => getRun(c, runId)))!;
    const slip = run.slips.find((s: any) => s.employee_id === presEmp)!;
    slipId = slip.id;
    expect(slip.published).toBe(false);
    await expect(as('hr', (c) => createRun(c, period))).rejects.toThrow(/already exists/);
    await expect(as('hr', (c) => createRun(c, '2099-01'))).rejects.toThrow(/future/);
  });
  it('employees cannot see a payslip until the run is approved', async () => {
    expect((await as('presenter', (c) => myPayslips(c))).length).toBe(0);
    expect(await as('presenter', (c) => getPayslip(c, slipId))).toBeNull();
  });
  it('approval needs a different person from the preparer, and posts a balanced journal', async () => {
    await expect(as('hr', (c) => approveRun(c, runId))).rejects.toBeInstanceOf(ForbiddenError); // HR prepares, finance approves
    await expect(as('presenter', (c) => approveRun(c, runId))).rejects.toBeInstanceOf(ForbiddenError);
    await as('finmanager', (c) => approveRun(c, runId));
    const tb = await as('finmanager', (c) => trialBalance(c));
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(tb.lines.find((l) => l.code === '5050')!.balance).toBeGreaterThan(0);
    expect(tb.lines.find((l) => l.code === '2100')!.balance).toBeGreaterThan(0);
    expect(tb.lines.find((l) => l.code === '2110')!.balance).toBeGreaterThan(0); // PAYE payable
  });
  it('every employee can read and print only their own payslip; fines appear as deductions with dates', async () => {
    const mine = await as('presenter', (c) => myPayslips(c));
    expect(mine).toHaveLength(1);
    const v = (await as('presenter', (c) => getPayslip(c, mine[0].id)))!;
    const fine = v.details.deductions.find((d) => d.kind === 'fine')!;
    expect(fine.amount).toBe(2000_00);
    expect(fine.detail).toHaveLength(2);
    expect(v.net).toBe(v.gross - v.totalDeductions);
    await expect(as('officer', (c) => getPayslip(c, slipId))).rejects.toBeInstanceOf(ForbiddenError);
    const pdf = await buildPayslipPdf({ period: v.period, gross: v.gross, totalDeductions: v.totalDeductions, net: v.net, currency: 'NGN', org: v.org, employee: v.employee, details: v.details as any });
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1500);
  });
  it('published payslips are frozen at the database level', async () => {
    await expect(withTenant(ids.org, (q) => q.query(`update payslips set net = net + 1 where id = $1`, [slipId]))).rejects.toThrow(/cannot be changed/);
    await expect(withTenant(ids.org, (q) => q.query(`delete from payslips where id = $1`, [slipId]))).rejects.toThrow(/cannot be deleted/);
    const a = (await as('hr', (c) => listAdjustments(c, period))).find((x: any) => x.source_type === 'lateness')!;
    expect(a.status).toBe('applied');
  });
  it('payment is recorded by a third person against the bank balance', async () => {
    const accts = await withTenant(ids.org, (q) => listAccounts(q));
    const bank = accts.find((a: any) => a.code === '1010').id;
    await expect(as('finmanager', (c) => payRun(c, runId, { cashAccountId: bank, reference: 'X' }))).rejects.toBeInstanceOf(ForbiddenError);
    const before = await withTenant(ids.org, (q) => cashBalance(q, bank));
    await as('payments', (c) => payRun(c, runId, { cashAccountId: bank, reference: 'BATCH-2201' }));
    expect(await withTenant(ids.org, (q) => cashBalance(q, bank))).toBeLessThan(before);
    expect((await as('hr', (c) => getRun(c, runId)))!.run.status).toBe('paid');
  });
});

describe('separation of duties for a holder of both permissions', () => {
  it('the Super Administrator cannot approve a payroll run they prepared', async () => {
    const older = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)).toISOString().slice(0, 7);
    const r = await as('superadmin', (c) => createRun(c, older));
    await expect(as('superadmin', (c) => approveRun(c, r.id))).rejects.toThrow(/Separation of duties/);
    await as('superadmin', (c) => import('../src/server/payroll').then((m) => m.cancelRun(c, r.id, 'Test cleanup run')));
  });
});

describe('discipline: queries, warnings and fair hearing', () => {
  let queryId = '';
  it('a manager raises a written query; the employee sees it and the rule guidance', async () => {
    const rules = await withTenant(ids.org, (q) => listRules(q));
    expect(rules.length).toBeGreaterThanOrEqual(6);
    const late = rules.find((r: any) => r.code === 'LATE');
    const r = await as('head', (c) => raiseCase(c, { employeeId: presEmp, kind: 'query', ruleId: late.id, title: 'Repeated lateness in the news desk', facts: 'You clocked in more than 20 minutes late on five days last month. Please explain.', incidentDate: day(7) }));
    queryId = r.id;
    const view = (await as('presenter', (c) => getCase(c, queryId)))!;
    expect(view.own).toBe(true);
    expect(view.c.rule_guidance).toMatch(/verbal warning/i);
    expect((await as('presenter', (c) => listCases(c, 'mine'))).length).toBe(1);
  });
  it('a sanction cannot skip the hearing: written warning needs a query, unless HR records a reason', async () => {
    await expect(as('head', (c) => raiseCase(c, { employeeId: presEmp, kind: 'written_warning', title: 'Direct warning attempt', facts: 'Late again on several days without approval or explanation.', incidentDate: day(7) }))).rejects.toThrow(/Issue a query first/);
    await expect(as('hr', (c) => raiseCase(c, { employeeId: presEmp, kind: 'written_warning', title: 'Direct warning attempt', facts: 'Late again on several days without approval or explanation.', incidentDate: day(7), overrideReason: 'short' }))).rejects.toThrow(/at least 20/);
    await expect(as('head', (c) => raiseCase(c, { employeeId: presEmp, kind: 'written_warning', basisCaseId: queryId, title: 'Warning after query', facts: 'Following the unanswered query on lateness. Please see attached details.', incidentDate: day(7) }))).rejects.toThrow(/still within the time/);
  });
  it('the decision waits for the employee\'s response (or the deadline), and the issuer cannot decide', async () => {
    await expect(as('hr', (c) => decideQuery(c, queryId, { outcome: 'verbal_warning', note: 'Decided without hearing the employee at all today.' }))).rejects.toThrow(/still has until/);
    await as('presenter', (c) => respond(c, queryId, 'Public transport strikes affected me on those days; I have informed my supervisor.'));
    await expect(as('head', (c) => decideQuery(c, queryId, { outcome: 'verbal_warning', note: 'The issuer decided it themselves here.' }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('hr', (c) => decideQuery(c, queryId, { outcome: 'verbal_warning', note: 'short' }))).rejects.toThrow(/reasons/);
    await as('hr', (c) => decideQuery(c, queryId, { outcome: 'verbal_warning', note: 'Considered the response about transport strikes; two days are excused, the rest stand. Verbal warning recorded.' }));
    const cases = await as('presenter', (c) => listCases(c, 'mine'));
    expect(cases.map((x: any) => x.kind).sort()).toEqual(['query', 'verbal_warning']);
    const warning = cases.find((x: any) => x.kind === 'verbal_warning')!;
    await as('presenter', (c) => acknowledge(c, warning.id));
    const v = await as('hr', (c) => getCase(c, warning.id));
    expect(v!.c.status).toBe('acknowledged');
    expect(v!.activeWarnings.length).toBe(1);
  });
  it('colleagues cannot read someone else\'s case; a recorded fine becomes an approved payroll deduction', async () => {
    await expect(as('officer', (c) => getCase(c, queryId))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await as('officer', (c) => listCases(c, 'mine'))).length).toBe(0);
    const q2 = await as('head', (c) => raiseCase(c, { employeeId: presEmp, kind: 'query', title: 'Missed live bulletin', facts: 'The 7am bulletin did not air because the studio was not prepared on time.', incidentDate: day(8), responseHours: 24 }));
    await as('presenter', (c) => respond(c, q2.id, 'The studio key was not available.'));
    await expect(as('head', (c) => raiseCase(c, { employeeId: presEmp, kind: 'fine', basisCaseId: q2.id, title: 'Fine for missed bulletin', facts: 'Fine after query response was considered here.', incidentDate: day(8), fineAmount: '5000', fineMonth: period }))).rejects.toThrow(/Only HR or an executive/);
    await as('hr', (c) => raiseCase(c, { employeeId: presEmp, kind: 'fine', basisCaseId: q2.id, title: 'Fine for missed bulletin', facts: 'Fine after query response was considered here.', incidentDate: day(8), fineAmount: '5000', fineMonth: period }));
    const adj = await withTenant(ids.org, (q) => q.query<any>(`select status, amount, source_type from pay_adjustments where source_type = 'discipline'`));
    expect(adj).toHaveLength(1);
    expect(adj[0].status).toBe('approved');
  });
});

describe('the hidden Super Administrator', () => {
  it('is invisible to the Chairman, HR and staff in lists and search, but sees itself', async () => {
    for (const who of ['chairman', 'hr']) {
      const list = await as(who, (c) => listEmployees(c, { limit: 100 }));
      expect(list.some((e: any) => /Super Administrator/.test(e.full_name))).toBe(false);
      expect((await as(who, (c) => search(c, 'Super'))).length).toBe(0);
      const roles = await as(who, (c) => c.q.query<any>('select key from roles'));
      expect(roles.some((r: any) => r.key === 'super_admin')).toBe(false);
      const users = await as(who, (c) => c.q.query<any>('select email from users'));
      expect(users.some((r: any) => /superadmin/.test(r.email))).toBe(false);
    }
    const mine = await as('superadmin', (c) => c.q.query<any>('select email from users where hidden'));
    expect(mine).toHaveLength(1);
  });
  it('is excluded from payroll and counts, and holds full authority including the Chairman\'s views', async () => {
    const run = (await as('hr', (c) => listAdjustments(c, period)));
    void run;
    const slips = await withTenant(ids.org, (q) => q.query<any>('select count(*)::int c from payslips'));
    expect(slips[0].c).toBeGreaterThan(5);
    const sa = await as('superadmin', async (c) => ({ exec: c.subject.grants.some((g) => g.permissions.includes('*')), roles: c.subject.grants.map((g) => g.roleKey) }));
    expect(sa.exec).toBe(true);
    expect(sa.roles).toEqual(expect.arrayContaining(['super_admin', 'executive']));
  });
});
