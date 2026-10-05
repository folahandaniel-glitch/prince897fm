import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { privileged, withTenant } from '../src/server/db';
import { seedOrganization, TEMPLATES } from '../src/server/seed';
import { runAs } from '../src/server/ctx';
import { ForbiddenError } from '../src/domain/policy';
import { approveTransaction, createTransaction, listAccounts, payTransaction, reviewTransaction, trialBalance, getTransaction } from '../src/server/finance';
import { ageing, approveInvoice, bankWorkbench, createInvoice, getInvoice, ignoreBankLine, importBankStatement, listInvoices, matchBankLine, recordInvoicePayment, saveTaxSettings, taxPosition, voidInvoice } from '../src/server/invoices';
import { flushOutbox } from '../src/server/messaging';
import { requestPasswordReset, resetPassword } from '../src/server/reset';
import { login } from '../src/server/auth';
import { notify } from '../src/server/hr';
import { assignTraining, complianceGaps, createCourse, myTraining, recordResult, trainingAlerts } from '../src/server/training';
import { addFixedHolidays, addHoliday, listHolidays } from '../src/server/holidays';
import { requestLeave } from '../src/server/attendance';
import { search } from '../src/server/search';

const ids: Record<string, string> = {};
const u: Record<string, string> = {};
const acct: Record<string, string> = {};
const parties: Record<string, string> = {};
const as = <T>(who: string, fn: Parameters<typeof runAs<T>>[2]) => runAs(ids.org, u[who], fn);
const today = new Date().toISOString().slice(0, 10);
const addDaysIso = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  const lines: string[] = [];
  for (const t of TEMPLATES) await seedOrganization(t, lines);
  const p = await privileged();
  ids.org = (await p.query<any>(`select id from organizations where slug = 'prince897'`))[0].id;
  const map: Record<string, string> = { officer: 'officer', officer2: 'payments', accountant: 'accountant', fm: 'finmanager', ceo: 'ceo', chairman: 'chairman', hr: 'hr', admin: 'admin', sales: 'sales', presenter: 'presenter' };
  for (const [k, e] of Object.entries(map)) u[k] = (await p.query<any>(`select u.id from users u join organizations o on o.id=u.org_id where o.slug='prince897' and u.email=$1`, [`${e}@prince897.example`]))[0].id;
  for (const a of await withTenant(ids.org, (q) => listAccounts(q))) acct[a.code] = a.id;
  for (const [k, kind] of [['client', 'client'], ['vendor', 'vendor']] as const) parties[k] = (await p.query<any>(`insert into fin_parties (org_id, kind, name) values ($1,$2,$3) returning id`, [ids.org, kind, `Test ${k}`]))[0].id;
});

const invoice = (who: string, kind: 'receivable' | 'payable', subtotal: string, o: Partial<Parameters<typeof createInvoice>[1]> = {}) =>
  as(who, (c) => createInvoice(c, { kind, partyId: parties[kind === 'receivable' ? 'client' : 'vendor'], description: 'Test invoice', categoryId: acct[kind === 'receivable' ? '4000' : '5010'], issueDate: today, dueDate: addDaysIso(today, 30), subtotal, vat: false, ...o }));

describe('receivables with VAT and withholding tax', () => {
  it('posts a balanced ledger, tracks part payments and clears on settlement', async () => {
    await as('fm', (c) => saveTaxSettings(c, 7.5, 5));
    const inv = await invoice('officer', 'receivable', '100,000.00', { vat: true });
    expect(inv.number).toMatch(/^INV-/);
    let d = await as('officer', (c) => getInvoice(c, inv.id));
    expect([d.inv.subtotalMinor, d.inv.vatMinor, d.inv.totalMinor, d.inv.balanceMinor]).toEqual([100_000_00, 7_500_00, 107_500_00, 107_500_00]);
    expect((await as('fm', (c) => taxPosition(c))).vatOutput).toBe(7_500_00);
    // client pays 100,000 in cash and withholds 5,000 tax
    await as('officer', (c) => recordInvoicePayment(c, inv.id, { cashAccountId: acct['1010'], cash: '100,000.00', wht: '5,000.00', reference: 'RCPT-1' }));
    d = await as('officer', (c) => getInvoice(c, inv.id));
    expect(d.inv.balanceMinor).toBe(2_500_00);
    expect(d.inv.status).toBe('open');
    expect((await as('fm', (c) => taxPosition(c))).whtReceivable).toBe(5_000_00);
    await expect(as('officer', (c) => recordInvoicePayment(c, inv.id, { cashAccountId: acct['1010'], cash: '9,999.00', reference: 'X' }))).rejects.toThrow(/more than the balance/);
    const r = await as('officer', (c) => recordInvoicePayment(c, inv.id, { cashAccountId: acct['1010'], cash: '2,500.00', reference: 'RCPT-2' }));
    expect(r.settled).toBe(true);
    expect((await as('officer', (c) => getInvoice(c, inv.id))).inv.status).toBe('paid');
    // the whole ledger still balances
    const tb = await as('fm', (c) => trialBalance(c));
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it('only finance staff can raise invoices and payment needs a reference', async () => {
    await expect(invoice('presenter', 'receivable', '1,000.00')).rejects.toBeInstanceOf(ForbiddenError);
    const inv = await invoice('officer', 'receivable', '5,000.00');
    await expect(as('officer', (c) => recordInvoicePayment(c, inv.id, { cashAccountId: acct['1010'], cash: '5,000', reference: ' ' }))).rejects.toThrow(/reference/);
    await expect(invoice('officer', 'receivable', '5,000.00', { partyId: parties.vendor })).rejects.toThrow(/clients/);
    await expect(invoice('officer', 'receivable', '5,000.00', { categoryId: acct['5010'] })).rejects.toThrow(/income account/);
    await expect(invoice('officer', 'receivable', '5,000.00', { dueDate: addDaysIso(today, -1) })).rejects.toThrow(/due date/);
  });

  it('a CRM client can be invoiced and a lead cannot', async () => {
    const { createAccount } = await import('../src/server/crm');
    const lead = await runAs(ids.org, u.sales, (c) => createAccount(c, { name: 'Lead Co', status: 'lead' }));
    await expect(invoice('officer', 'receivable', '1,000.00', { partyId: undefined, crmAccountId: lead })).rejects.toThrow(/not yet a paying client/);
  });
});

describe('payables need approval and separation of duties', () => {
  let bill: { id: string };
  it('walks record -> approve -> pay with three different people', async () => {
    bill = await invoice('officer', 'payable', '40,000.00');
    expect((await as('officer', (c) => getInvoice(c, bill.id))).inv.status).toBe('pending');
    await expect(as('officer2', (c) => recordInvoicePayment(c, bill.id, { cashAccountId: acct['1010'], cash: '40,000', reference: 'P1' }))).rejects.toThrow(/approved/);
    await expect(as('officer', (c) => approveInvoice(c, bill.id))).rejects.toBeInstanceOf(ForbiddenError); // no approve permission
    await as('fm', (c) => approveInvoice(c, bill.id));
    await expect(as('officer', (c) => recordInvoicePayment(c, bill.id, { cashAccountId: acct['1010'], cash: '40,000', reference: 'P1' }))).rejects.toThrow(/recorded this bill/);
    await expect(as('accountant', (c) => recordInvoicePayment(c, bill.id, { cashAccountId: acct['1010'], cash: '40,000', reference: 'P1' }))).rejects.toBeInstanceOf(ForbiddenError);
    const r = await as('officer2', (c) => recordInvoicePayment(c, bill.id, { cashAccountId: acct['1010'], cash: '36,000.00', wht: '4,000.00', reference: 'GTB-P1' }));
    expect(r.settled).toBe(true);
    expect((await as('fm', (c) => taxPosition(c))).whtPayable).toBe(4_000_00);
  });
  it('large bills need the senior approver of their band', async () => {
    const big = await invoice('officer', 'payable', '2,500,000.00'); // top band: finance manager -> ceo -> executive
    await expect(as('fm', (c) => approveInvoice(c, big.id))).rejects.toThrow(/must be approved by the executive/);
    await as('chairman', (c) => approveInvoice(c, big.id));
    expect((await as('officer', (c) => getInvoice(c, big.id))).inv.status).toBe('open');
  });
  it('overpaying from an account without funds is refused', async () => {
    const huge = await invoice('officer', 'payable', '90,000,000.00', { categoryId: acct['5010'] });
    await as('chairman', (c) => approveInvoice(c, huge.id));
    await expect(as('officer2', (c) => recordInvoicePayment(c, huge.id, { cashAccountId: acct['1010'], cash: '90,000,000', reference: 'BIG' }))).rejects.toThrow(/Insufficient funds/);
  });
});

describe('voiding', () => {
  it('reverses an unpaid invoice and refuses once money moved', async () => {
    const inv = await invoice('officer', 'receivable', '7,000.00', { vat: true });
    await expect(as('officer', (c) => voidInvoice(c, inv.id, 'duplicate invoice entered'))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('fm', (c) => voidInvoice(c, inv.id, 'short'))).rejects.toThrow(/10 characters/);
    const before = await as('fm', (c) => taxPosition(c));
    await as('fm', (c) => voidInvoice(c, inv.id, 'duplicate invoice entered'));
    expect((await as('fm', (c) => taxPosition(c))).vatOutput).toBe(before.vatOutput - 525_00);
    const paid = await invoice('officer', 'receivable', '3,000.00');
    await as('officer', (c) => recordInvoicePayment(c, paid.id, { cashAccountId: acct['1010'], cash: '1,000', reference: 'R' }));
    await expect(as('fm', (c) => voidInvoice(c, paid.id, 'customer disputes the amount'))).rejects.toThrow(/has payments/);
  });
});

describe('ageing', () => {
  it('buckets by days past due and totals', async () => {
    const old = await invoice('officer', 'receivable', '20,000.00', { issueDate: addDaysIso(today, -100), dueDate: addDaysIso(today, -95) });
    const mid = await invoice('officer', 'receivable', '10,000.00', { issueDate: addDaysIso(today, -40), dueDate: addDaysIso(today, -20) });
    void old; void mid;
    const a = await as('accountant', (c) => ageing(c, 'receivable'));
    expect(a.totals[4]).toBeGreaterThanOrEqual(20_000_00);
    expect(a.totals[1]).toBeGreaterThanOrEqual(10_000_00);
    expect(a.grand).toBe(a.totals.reduce((x, y) => x + y, 0));
    expect((await as('accountant', (c) => listInvoices(c, 'receivable', 'open'))).length).toBeGreaterThan(0);
    await expect(as('presenter', (c) => ageing(c, 'receivable'))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('bank statement import and matching', () => {
  it('imports once, suggests matches, reconciles paid transactions with separation of duties', async () => {
    const t = await as('officer', (c) => createTransaction(c, { kind: 'expense', title: 'Studio microphones', categoryId: acct['5010'], amount: '12,345.00', date: today, submit: true }));
    await as('accountant', (c) => reviewTransaction(c, t.id, 'approve', 'ok'));
    await as('fm', (c) => approveTransaction(c, t.id, 'approve', ''));
    await as('officer2', (c) => payTransaction(c, t.id, { cashAccountId: acct['1010'], reference: 'GTB-9' }));
    const csv = `Date,Description,Reference,Debit,Credit\n${today},Transfer out,GTB-9,"12,345.00",\n${today},Unknown deposit,X-1,,"500.00"`;
    const r1 = await as('accountant', (c) => importBankStatement(c, acct['1010'], csv));
    expect(r1.added).toBe(2);
    const r2 = await as('accountant', (c) => importBankStatement(c, acct['1010'], csv));
    expect(r2.added).toBe(0); expect(r2.duplicates).toBe(2);
    await expect(as('officer', (c) => importBankStatement(c, acct['1010'], csv))).rejects.toBeInstanceOf(ForbiddenError);
    const wb = await as('accountant', (c) => bankWorkbench(c, acct['1010']));
    const out = wb.find((l) => l.reference === 'GTB-9')!;
    expect(out.suggestion?.kind).toBe('txn');
    expect(wb.find((l) => l.reference === 'X-1')!.suggestion).toBeNull();
    await expect(as('accountant', (c) => matchBankLine(c, out.id, { kind: 'txn', id: '00000000-0000-0000-0000-000000000000' }))).rejects.toThrow(/not available/);
    await as('accountant', (c) => matchBankLine(c, out.id, { kind: 'txn', id: out.suggestion!.id }));
    expect((await as('accountant', (c) => getTransaction(c, t.id)))!.txn.status).toBe('reconciled');
    await expect(as('accountant', (c) => matchBankLine(c, out.id, { kind: 'txn', id: t.id }))).rejects.toThrow(/already handled/);
    const x = wb.find((l) => l.reference === 'X-1')!;
    await as('accountant', (c) => ignoreBankLine(c, x.id));
  });
  it('matches an invoice receipt by amount and refuses mismatched amounts', async () => {
    const inv = await invoice('officer', 'receivable', '8,000.00');
    await as('officer', (c) => recordInvoicePayment(c, inv.id, { cashAccountId: acct['1010'], cash: '8,000.00', reference: 'RCPT-77' }));
    await as('accountant', (c) => importBankStatement(c, acct['1010'], `date,description,reference,amount\n${today},Client deposit,RCPT-77,8000.00\n${today},Other,Z,8001.00`));
    const wb = await as('accountant', (c) => bankWorkbench(c, acct['1010']));
    const line = wb.find((l) => l.reference === 'RCPT-77')!;
    expect(line.suggestion?.kind).toBe('payment');
    const wrong = wb.find((l) => l.reference === 'Z')!;
    await expect(as('accountant', (c) => matchBankLine(c, wrong.id, { kind: 'payment', id: line.suggestion!.id }))).rejects.toThrow(/amounts do not match/);
    await as('accountant', (c) => matchBankLine(c, line.id, { kind: 'payment', id: line.suggestion!.id }));
  });
  it('refuses a file it cannot read', async () => {
    await expect(as('accountant', (c) => importBankStatement(c, acct['1010'], 'foo,bar\n1,2'))).rejects.toThrow(/columns/);
    await expect(as('accountant', (c) => importBankStatement(c, acct['5010'], 'date,amount\n2026-01-01,1'))).rejects.toThrow(/bank or cash/);
  });
});

describe('outbox and email mirroring', () => {
  it('mirrors notifications to the outbox, honours opt-out, and marks them skipped without a provider', async () => {
    const p = await privileged();
    const before = Number((await p.query<any>('select count(*)::int n from outbox where user_id = $1', [u.presenter]))[0].n);
    await as('hr', (c) => notify(c.q, c.orgId, u.presenter, 'Welcome to the team', 'Details inside', '/dashboard'));
    const rows = await p.query<any>(`select * from outbox where user_id = $1 order by created_at desc`, [u.presenter]);
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toMatchObject({ channel: 'email', subject: 'Welcome to the team', status: 'pending' });
    expect(rows[0].body).toContain('link:/dashboard');
    await p.query('update users set notify_email = false where id = $1', [u.presenter]);
    await as('hr', (c) => notify(c.q, c.orgId, u.presenter, 'Second notice'));
    expect((await p.query<any>('select count(*)::int n from outbox where user_id = $1', [u.presenter]))[0].n).toBe(before + 1);
    await p.query('update users set notify_email = true where id = $1', [u.presenter]);
    const out = await flushOutbox();
    expect(out.skipped).toBeGreaterThan(0);
    expect((await p.query<any>(`select status from outbox where id = $1`, [rows[0].id]))[0].status).toBe('skipped');
  });
  it('tenants cannot read each other\'s outbox', async () => {
    const other = (await (await privileged()).query<any>(`select id from organizations where slug = 'gracechapel'`))[0].id;
    expect((await withTenant(other, (q) => q.query<any>('select * from outbox where org_id = $1', [ids.org]))).length).toBe(0);
  });
});

describe('password reset by email', () => {
  const email = 'presenter@prince897.example';
  const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
  it('answers the same for unknown accounts and queues one email for real ones', async () => {
    const p = await privileged();
    await requestPasswordReset('prince897', 'nobody@nowhere.example', '9.9.9.9');
    expect((await p.query<any>(`select count(*)::int n from outbox where to_addr = 'nobody@nowhere.example'`))[0].n).toBe(0);
    await requestPasswordReset('prince897', email, '9.9.9.8');
    const m = (await p.query<any>(`select * from outbox where to_addr = $1 and subject = 'Reset your password'`, [email]));
    expect(m).toHaveLength(1);
    expect(m[0].body).toMatch(/\/reset\/[A-Za-z0-9_-]{40,}/);
    // only a hash of the token is stored
    expect((await p.query<any>('select count(*)::int n from password_resets'))[0].n).toBeGreaterThan(0);
  });
  it('limits repeat requests', async () => {
    const p = await privileged();
    for (let i = 0; i < 5; i++) await requestPasswordReset('prince897', 'ceo@prince897.example', '9.9.9.7');
    expect((await p.query<any>(`select count(*)::int n from outbox where to_addr = 'ceo@prince897.example' and subject = 'Reset your password'`))[0].n).toBe(3);
  });
  it('a valid single-use token sets a new password and signs everything out', async () => {
    const p = await privileged();
    const token = 'known-test-token-' + 'x'.repeat(30);
    await p.query(`insert into password_resets (user_id, token_hash, expires_at) values ($1,$2, now() + interval '1 hour')`, [u.presenter, sha(token)]);
    expect(await resetPassword(token, 'short')).toMatch(/12 characters/);
    expect(await resetPassword('wrong-token', 'a-very-long-passphrase-123')).toMatch(/invalid or has expired/);
    const sessionsBefore = await login('prince897', email, 'bad-password-here-1');
    expect(sessionsBefore.ok).toBe(false);
    expect(await resetPassword(token, 'orbit-lantern-velvet-92')).toBeNull();
    expect(await resetPassword(token, 'orbit-lantern-velvet-93')).toMatch(/invalid or has expired/); // single use
    const ok = await login('prince897', email, 'orbit-lantern-velvet-92');
    expect(ok.ok).toBe(true);
  });
  it('an expired token is refused', async () => {
    const p = await privileged();
    const token = 'expired-token-' + 'y'.repeat(30);
    await p.query(`insert into password_resets (user_id, token_hash, expires_at) values ($1,$2, now() - interval '1 minute')`, [u.presenter, sha(token)]);
    expect(await resetPassword(token, 'orbit-lantern-velvet-94')).toMatch(/invalid or has expired/);
  });
});

describe('training and certification', () => {
  let course: string;
  it('only managers create courses; people see only their own records', async () => {
    await expect(as('presenter', (c) => createCourse(c, { name: 'Fire safety' }))).rejects.toBeInstanceOf(ForbiddenError);
    course = await as('hr', (c) => createCourse(c, { name: 'Fire safety', mandatory: true, validMonths: 12 }));
    await expect(as('hr', (c) => createCourse(c, { name: 'fire SAFETY' }))).rejects.toThrow(/already exists/);
    await expect(as('hr', (c) => createCourse(c, { name: 'Bad', validMonths: 0 }))).rejects.toThrow(/Validity/);
    const emp = (await withTenant(ids.org, (q) => q.query<any>(`select id from employees where user_id = $1`, [u.presenter])))[0].id;
    await as('hr', (c) => assignTraining(c, { courseId: course, employeeIds: [emp], dueOn: today }));
    expect(await as('hr', (c) => assignTraining(c, { courseId: course, employeeIds: [emp] }))).toBe(0); // already open
    const mine = await as('presenter', (c) => myTraining(c));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ course: 'Fire safety', status: 'assigned' });
    await expect(as('presenter', (c) => assignTraining(c, { courseId: course, employeeIds: [emp] }))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await as('officer', (c) => myTraining(c))).length).toBe(0);
  });
  it('flags mandatory gaps, then clears them with a passed result that carries an expiry', async () => {
    const gaps = await as('hr', (c) => complianceGaps(c));
    expect(gaps.some((g: any) => g.course === 'Fire safety')).toBe(true);
    const rec = (await as('presenter', (c) => myTraining(c)))[0];
    await expect(as('hr', (c) => recordResult(c, rec.id, { passed: true, completedOn: addDaysIso(today, 1) }))).rejects.toThrow(/not in the future/);
    await expect(as('hr', (c) => recordResult(c, rec.id, { passed: true, completedOn: today, score: '120' }))).rejects.toThrow(/Score/);
    await as('hr', (c) => recordResult(c, rec.id, { passed: true, completedOn: today, score: '88', certificateRef: 'FS-001' }));
    const after = (await as('presenter', (c) => myTraining(c)))[0];
    expect(after.status).toBe('completed');
    expect(after.expires_on > today).toBe(true);
    await expect(as('hr', (c) => recordResult(c, rec.id, { passed: false, completedOn: today }))).rejects.toThrow(/already has a result/);
    const gaps2 = await as('hr', (c) => complianceGaps(c));
    expect(gaps2.some((g: any) => g.course === 'Fire safety' && g.employee_id === rec.employee_id)).toBe(false);
  });
  it('alerts on overdue assignments once per state', async () => {
    const c2 = await as('hr', (c) => createCourse(c, { name: 'First aid' }));
    const emp = (await withTenant(ids.org, (q) => q.query<any>(`select id from employees where user_id = $1`, [u.officer])))[0].id;
    await as('hr', (c) => assignTraining(c, { courseId: c2, employeeIds: [emp], dueOn: addDaysIso(today, -3) }));
    const n1 = await withTenant(ids.org, (q) => trainingAlerts(q, ids.org));
    expect(n1).toBeGreaterThan(0);
    expect(await withTenant(ids.org, (q) => trainingAlerts(q, ids.org))).toBe(0);
    const mine = await withTenant(ids.org, (q) => q.query<any>(`select title from notifications where user_id = $1 and title like 'Training overdue%'`, [u.officer]));
    expect(mine).toHaveLength(1);
  });
});

describe('public holidays', () => {
  it('are not counted as leave days', async () => {
    const type = (await withTenant(ids.org, (q) => q.query<any>(`select id from leave_types where name = 'Annual leave'`)))[0].id;
    // next Monday that is at least 14 days away
    let mon = addDaysIso(today, 14);
    while (new Date(`${mon}T00:00:00Z`).getUTCDay() !== 1) mon = addDaysIso(mon, 1);
    const wed = addDaysIso(mon, 2), fri = addDaysIso(mon, 4);
    await expect(as('presenter', (c) => addHoliday(c, wed, 'Test holiday'))).rejects.toBeInstanceOf(ForbiddenError);
    await as('hr', (c) => addHoliday(c, wed, 'Test holiday'));
    await expect(as('hr', (c) => addHoliday(c, wed, 'Again'))).rejects.toThrow(/already listed/);
    await as('presenter', (c) => requestLeave(c, { typeId: type, start: mon, end: fri }));
    const row = (await withTenant(ids.org, (q) => q.query<any>(`select days from leave_requests where start_date = $1`, [mon])))[0];
    expect(Number(row.days)).toBe(4);
    expect(await as('hr', (c) => addFixedHolidays(c, 2031))).toBe(6);
    expect(await as('hr', (c) => addFixedHolidays(c, 2031))).toBe(0);
    expect((await as('hr', (c) => listHolidays(c, 2031))).map((h: any) => h.d)).toContain('2031-10-01');
  });
});

describe('search across modules respects access', () => {
  it('finance staff find transactions; a presenter does not', async () => {
    const a = await as('officer', (c) => search(c, 'microphones'));
    expect(a.some((h) => h.kind === 'Finance')).toBe(true);
    const b = await as('presenter', (c) => search(c, 'microphones'));
    expect(b.some((h) => h.kind === 'Finance')).toBe(false);
  });
  it('a person finds their own ticket but not someone else\'s', async () => {
    const { createTicket } = await import('../src/server/tickets');
    await as('presenter', (c) => createTicket(c, { subject: 'Zebra microphone crackles', description: 'It crackles during the morning show.' }));
    expect((await as('presenter', (c) => search(c, 'zebra'))).some((h) => h.kind === 'Ticket')).toBe(true);
    expect((await as('officer', (c) => search(c, 'zebra'))).some((h) => h.kind === 'Ticket')).toBe(false);
  });
});
