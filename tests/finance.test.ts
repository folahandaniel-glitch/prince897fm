import { beforeAll, describe, expect, it } from 'vitest';
import { privileged, withTenant } from '../src/server/db';
import { seedOrganization, TEMPLATES } from '../src/server/seed';
import { runAs } from '../src/server/ctx';
import { ForbiddenError } from '../src/domain/policy';
import { fromDb } from '../src/domain/finance';
import {
  addAttachment, approveTransaction, budgetVsActual, cashBalance, createTransaction, financeOverview, getAttachment, getTransaction, listAccounts, listBands, listTransactions,
  payTransaction, postManual, reconcileTransaction, registerCsv, reviewTransaction, saveBand, setPeriod, trialBalance, voidTransaction, workQueues,
} from '../src/server/finance';

const ids: Record<string, string> = {};
const u: Record<string, string> = {};
const acct: Record<string, string> = {};
const as = <T>(who: string, fn: Parameters<typeof runAs<T>>[2]) => runAs(ids.org, u[who], fn);
const today = new Date().toISOString().slice(0, 10);

const expense = (amount: string, title = 'Studio microphones') => as('officer', (c) => createTransaction(c, { kind: 'expense', title, categoryId: acct['5010'], amount, date: today, submit: true }));
async function toApproved(amount: string, approvers: string[], title?: string) {
  const t = await expense(amount, title);
  await as('accountant', (c) => reviewTransaction(c, t.id, 'approve', 'Checked quote'));
  for (const a of approvers) await as(a, (c) => approveTransaction(c, t.id, 'approve', ''));
  return t;
}
const bank = () => withTenant(ids.org, (q) => cashBalance(q, acct['1010']));

beforeAll(async () => {
  const lines: string[] = [];
  for (const t of TEMPLATES) await seedOrganization(t, lines);
  const p = await privileged();
  ids.org = (await p.query<any>(`select id from organizations where slug = 'prince897'`))[0].id;
  ids.church = (await p.query<any>(`select id from organizations where slug = 'gracechapel'`))[0].id;
  const map: Record<string, string> = { officer: 'officer', officer2: 'payments', accountant: 'accountant', fm: 'finmanager', ceo: 'ceo', chairman: 'chairman', hr: 'hr', admin: 'admin', presenter: 'presenter' };
  for (const [k, e] of Object.entries(map)) u[k] = (await p.query<any>(`select u.id from users u join organizations o on o.id=u.org_id where o.slug='prince897' and u.email=$1`, [`${e}@prince897.example`]))[0].id;
  for (const a of await withTenant(ids.org, (q) => listAccounts(q))) acct[a.code] = a.id;
});

describe('standard expense lifecycle with segregation of duties', () => {
  let t: { id: string; number: string };
  it('create -> review -> approve (band 1) -> pay -> reconcile, with the ledger posting at the right moments', async () => {
    const before = await bank();
    t = await expense('150,000.00');
    expect(t.number).toMatch(/^EXP-/);
    // creator cannot review (no permission) and an accountant cannot approve
    await expect(as('officer', (c) => reviewTransaction(c, t.id, 'approve', ''))).rejects.toBeInstanceOf(ForbiddenError);
    await as('accountant', (c) => reviewTransaction(c, t.id, 'approve', 'Quote attached'));
    expect((await as('fm', (c) => getTransaction(c, t.id)))!.txn.approval_steps).toEqual(['finance_manager']);
    await expect(as('accountant', (c) => approveTransaction(c, t.id, 'approve', ''))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await as('fm', (c) => getTransaction(c, t.id)))!.entries.length).toBe(0); // nothing posted before approval
    expect(await as('fm', (c) => approveTransaction(c, t.id, 'approve', 'OK'))).toBe('approved');
    expect((await as('fm', (c) => getTransaction(c, t.id)))!.entries.length).toBe(1); // accrual: Dr expense / Cr payables
    // payer must be someone who did not create, review or approve
    await expect(as('officer', (c) => payTransaction(c, t.id, { cashAccountId: acct['1010'], reference: 'TRF-1' }))).rejects.toThrow(/created this transaction/);
    await as('officer2', (c) => payTransaction(c, t.id, { cashAccountId: acct['1010'], reference: 'GTB-77821' }));
    expect(await bank()).toBe(before - 150_000_00);
    await expect(as('officer2', (c) => reconcileTransaction(c, t.id, 'STMT-1'))).rejects.toBeInstanceOf(ForbiddenError);
    await as('accountant', (c) => reconcileTransaction(c, t.id, 'Statement line 14'));
    const d = (await as('accountant', (c) => getTransaction(c, t.id)))!;
    expect(d.txn.status).toBe('reconciled');
    expect(d.approvals.map((a: any) => a.action)).toEqual(['submitted', 'reviewed', 'approved', 'paid', 'reconciled']);
    expect(d.entries.length).toBe(2);
  });
  it('a paid transaction cannot be paid or approved again', async () => {
    await expect(as('officer2', (c) => payTransaction(c, t.id, { cashAccountId: acct['1010'], reference: 'again' }))).rejects.toThrow(/Only approved/);
    await expect(as('fm', (c) => approveTransaction(c, t.id, 'approve', ''))).rejects.toThrow(/not waiting/);
  });
});

describe('approval bands: bigger amounts need more approvers', () => {
  it('2.5M needs finance manager, CEO and Chairman in order; wrong role or repeat approver is refused', async () => {
    const t = await expense('2,500,000.00', 'Transmitter replacement');
    await as('accountant', (c) => reviewTransaction(c, t.id, 'approve', ''));
    await expect(as('ceo', (c) => approveTransaction(c, t.id, 'approve', ''))).rejects.toThrow(/finance_manager role/);
    expect(await as('fm', (c) => approveTransaction(c, t.id, 'approve', ''))).toBe('reviewed');
    await expect(as('fm', (c) => approveTransaction(c, t.id, 'approve', ''))).rejects.toThrow();
    expect(await as('ceo', (c) => approveTransaction(c, t.id, 'approve', ''))).toBe('reviewed');
    expect(await as('chairman', (c) => approveTransaction(c, t.id, 'approve', 'Approved'))).toBe('approved');
    // insufficient funds are refused rather than overdrawing the account
    await expect(as('officer2', (c) => payTransaction(c, t.id, { cashAccountId: acct['1000'], reference: 'cash' }))).rejects.toThrow(/Insufficient funds/);
    await as('officer2', (c) => payTransaction(c, t.id, { cashAccountId: acct['1010'], reference: 'BANK-2' }));
  });
  it('bands are configurable by the Finance Manager only', async () => {
    await expect(as('officer', (c) => saveBand(c, '500000', ['finance_manager']))).rejects.toBeInstanceOf(ForbiddenError);
    await as('fm', (c) => saveBand(c, '5,000,000', ['finance_manager', 'ceo', 'executive']));
    expect((await withTenant(ids.org, (q) => listBands(q))).length).toBe(4);
    await expect(as('fm', (c) => saveBand(c, '100', ['nonexistent']))).rejects.toThrow(/Unknown role/);
  });
  it('rejection and return need a reason and stop the flow', async () => {
    const t = await expense('90,000');
    await expect(as('accountant', (c) => reviewTransaction(c, t.id, 'reject', ''))).rejects.toThrow(/reason/);
    await as('accountant', (c) => reviewTransaction(c, t.id, 'return', 'Missing quotation'));
    expect((await as('fm', (c) => getTransaction(c, t.id)))!.txn.status).toBe('draft');
  });
});

describe('who can see or do what', () => {
  it('HR and employees have no finance access by default (the Administrator controls finance set-up and entries but not the Chairman-stage approvals)', async () => {
    for (const who of ['hr', 'presenter']) {
      await expect(as(who, (c) => listAccounts(c.q).then(() => trialBalance(c)))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(as(who, (c) => financeOverview(c))).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await as('presenter', (c) => listTransactions(c))).length).toBe(0); // sees only what they created (nothing)
  });
  it('work queues only show steps the person is allowed to take', async () => {
    const t = await expense('60,000', 'Queue test');
    expect((await as('accountant', (c) => workQueues(c))).review.map((r: any) => r.id)).toContain(t.id);
    expect((await as('officer', (c) => workQueues(c))).review.length).toBe(0);
    expect((await as('fm', (c) => workQueues(c))).review.length).toBe(0);
  });
});

describe('ledger integrity', () => {
  it('rejects unbalanced entries at commit, even if application code is bypassed', async () => {
    await expect(withTenant(ids.org, async (q) => {
      const [{ id }] = await q.query<any>(`insert into fin_journal_entries (org_id, entry_no, entry_date, memo, source_type, created_by) values ($1, 9999, current_date, 'bad', 'manual', $2) returning id`, [ids.org, u.fm]);
      await q.query(`insert into fin_journal_lines (org_id, entry_id, account_id, debit, credit) values ($1,$2,$3,100,0)`, [ids.org, id, acct['1010']]);
    })).rejects.toThrow(/not balanced/);
  });
  it('the app role cannot edit or delete journal entries, lines, approvals or attachments', async () => {
    for (const sql of ['update fin_journal_lines set debit = debit', 'delete from fin_journal_entries', 'update fin_approvals set note = null', 'delete from fin_attachments'])
      await expect(withTenant(ids.org, (q) => q.query(sql))).rejects.toThrow();
  });
  it('the trial balance always balances', async () => {
    const tb = await as('accountant', (c) => trialBalance(c));
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(tb.totalDebit).toBeGreaterThan(0);
  });
  it('manual entries need a real explanation and balanced lines', async () => {
    await expect(as('fm', (c) => postManual(c, { date: today, memo: 'short', lines: [] }))).rejects.toThrow(/Explain/);
    await expect(as('fm', (c) => postManual(c, { date: today, memo: 'Correct misposted fuel', lines: [{ accountId: acct['5020'], debit: '100' }, { accountId: acct['5900'], credit: '90' }] }))).rejects.toThrow(/equal/);
    expect(await as('fm', (c) => postManual(c, { date: today, memo: 'Correct misposted fuel', lines: [{ accountId: acct['5020'], debit: '100' }, { accountId: acct['5900'], credit: '100' }] }))).toBeGreaterThan(0);
    await expect(as('officer', (c) => postManual(c, { date: today, memo: 'Sneaky adjustment here', lines: [] }))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('void, reversal and period close', () => {
  it('voiding reverses every entry, restores balances and keeps the original history', async () => {
    const before = await bank();
    const t = await toApproved('120,000', ['fm'], 'To be voided');
    await as('officer2', (c) => payTransaction(c, t.id, { cashAccountId: acct['1010'], reference: 'V-1' }));
    expect(await bank()).toBe(before - 120_000_00);
    await expect(as('officer2', (c) => voidTransaction(c, t.id, 'Duplicate payment of invoice'))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('fm', (c) => voidTransaction(c, t.id, 'short'))).rejects.toThrow(/at least 10/);
    await as('fm', (c) => voidTransaction(c, t.id, 'Duplicate payment of invoice'));
    expect(await bank()).toBe(before);
    const d = (await as('fm', (c) => getTransaction(c, t.id)))!;
    expect(d.txn.status).toBe('void');
    expect(d.entries.length).toBe(4); // 2 originals + 2 reversals, nothing deleted
    expect(d.entries.filter((e: any) => e.source_type === 'reversal').length).toBe(2);
  });
  it('a closed period refuses postings; reopening needs a reason', async () => {
    const d = new Date();
    await as('fm', (c) => setPeriod(c, d.getUTCFullYear(), d.getUTCMonth() + 1, true));
    const t = await expense('40,000', 'After close');
    await as('accountant', (c) => reviewTransaction(c, t.id, 'approve', ''));
    await expect(as('fm', (c) => approveTransaction(c, t.id, 'approve', ''))).rejects.toThrow(/closed/);
    await expect(as('fm', (c) => setPeriod(c, d.getUTCFullYear(), d.getUTCMonth() + 1, false))).rejects.toThrow(/reason/);
    await as('fm', (c) => setPeriod(c, d.getUTCFullYear(), d.getUTCMonth() + 1, false, 'Late invoice to be posted'));
    expect(await as('fm', (c) => approveTransaction(c, t.id, 'approve', ''))).toBe('approved');
  });
});

describe('income, transfers, budgets', () => {
  it('income is recorded, verified by the accountant (posting), then reconciled by someone else', async () => {
    const before = await bank();
    const t = await as('officer', (c) => createTransaction(c, { kind: 'income', title: 'Advert: Ibadan Cement, October', categoryId: acct['4000'], cashAccountId: acct['1010'], amount: '800,000', date: today, submit: true }));
    await as('accountant', (c) => reviewTransaction(c, t.id, 'approve', 'Receipt matched'));
    expect(await bank()).toBe(before + 800_000_00);
    await expect(as('accountant', (c) => reconcileTransaction(c, t.id, 'S1'))).rejects.toThrow(/someone else/);
    await as('fm', (c) => reconcileTransaction(c, t.id, 'Statement line 3'));
    expect((await as('fm', (c) => getTransaction(c, t.id)))!.txn.status).toBe('reconciled');
  });
  it('transfers move money between cash accounts after approval and require two different accounts', async () => {
    await expect(as('officer', (c) => createTransaction(c, { kind: 'transfer', title: 'Same account', categoryId: acct['1010'], cashAccountId: acct['1010'], amount: '1000', date: today }))).rejects.toThrow(/two different/);
    const t = await as('officer', (c) => createTransaction(c, { kind: 'transfer', title: 'Top up petty cash', categoryId: acct['1020'], cashAccountId: acct['1010'], amount: '50,000', date: today, submit: true }));
    await as('accountant', (c) => reviewTransaction(c, t.id, 'approve', ''));
    await as('fm', (c) => approveTransaction(c, t.id, 'approve', ''));
    const [b, p] = [await bank(), await withTenant(ids.org, (q) => cashBalance(q, acct['1020']))];
    await as('officer2', (c) => payTransaction(c, t.id, { cashAccountId: acct['1010'], reference: 'TRF-PC' }));
    expect(await bank()).toBe(b - 50_000_00);
    expect(await withTenant(ids.org, (q) => cashBalance(q, acct['1020']))).toBe(p + 50_000_00);
  });
  it('budget versus actual reflects posted spend', async () => {
    const rows = await as('accountant', (c) => budgetVsActual(c, new Date().getUTCFullYear()));
    const eng = rows.find((r) => r.code === '5010')!;
    expect(eng.budget).toBe(3_000_000_00);
    expect(eng.spent).toBeGreaterThan(0);
    expect(eng.remaining).toBe(eng.budget - eng.spent);
  });
});

describe('documents, exports and the Chairman view', () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('x'.repeat(200))]);
  it('accepts real PDFs, rejects disguised files and oversize uploads, and detects tampering', async () => {
    const t = await expense('30,000', 'With receipt');
    const id = await as('officer', (c) => addAttachment(c, t.id, 'receipt.pdf', pdf));
    await expect(as('officer', (c) => addAttachment(c, t.id, 'receipt.pdf', Buffer.from('MZ\x90\x00 fake exe')))).rejects.toThrow(/PDF, PNG or JPEG/);
    await expect(as('officer', (c) => addAttachment(c, t.id, 'big.pdf', Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(2 * 1024 * 1024)])))).rejects.toThrow(/2 MB/);
    await expect(as('presenter', (c) => addAttachment(c, t.id, 'x.pdf', pdf))).rejects.toThrow();
    expect((await as('accountant', (c) => getAttachment(c, id)))!.mime).toBe('application/pdf');
    await expect(as('presenter', (c) => getAttachment(c, id))).rejects.toBeInstanceOf(ForbiddenError);
    await (await privileged()).query(`update fin_attachments set data = decode('255044462d', 'hex') || data where id = $1`, [id]); // someone swaps the file in the database
    await expect(as('accountant', (c) => getAttachment(c, id))).rejects.toThrow(/Integrity check failed/);
  });
  it('CSV export neutralises spreadsheet formulas and is permission-gated and audited', async () => {
    await as('officer', (c) => createTransaction(c, { kind: 'expense', title: '=HYPERLINK("http://evil")', categoryId: acct['5900'], amount: '1000', date: today }));
    const csv = await as('accountant', (c) => registerCsv(c, `${today.slice(0, 4)}-01-01`, today));
    expect(csv).toContain(`"'=HYPERLINK`);
    await expect(as('officer', (c) => registerCsv(c, today, today))).rejects.toBeInstanceOf(ForbiddenError);
    const n = await withTenant(ids.org, (q) => q.query<any>(`select count(*)::int c from audit_events where action = 'finance.exported'`));
    expect(n[0].c).toBe(1);
  });
  it('the Chairman sees cash position, spending, pending approvals and exceptions; figures reconcile with the ledger', async () => {
    const o = await as('chairman', (c) => financeOverview(c));
    const tb = await as('chairman', (c) => trialBalance(c));
    const cashFromTb = tb.lines.filter((l) => ['1000', '1010', '1020'].includes(l.code)).reduce((s, l) => s + l.balance, 0);
    expect(o.available + o.restricted).toBe(cashFromTb);
    expect(o.net).toBe(o.available - o.payables);
    expect(o.periods.year.expense).toBeGreaterThan(0);
    expect(o.pending.review + o.pending.approval + o.pending.toPay).toBeGreaterThan(0);
    expect(Array.isArray(o.exceptions)).toBe(true);
    expect(o.trend.length).toBeGreaterThan(0);
    await expect(as('officer', (c) => financeOverview(c))).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('another organisation has no finance data', async () => {
    for (const t of ['fin_accounts', 'fin_transactions', 'fin_journal_entries', 'fin_attachments']) expect((await withTenant(ids.church, (q) => q.query<any>(`select count(*)::int c from ${t}`)))[0].c).toBe(0);
  });
  it('amounts are exact to the kobo', async () => {
    const t = await as('officer', (c) => createTransaction(c, { kind: 'expense', title: 'Odd amount', categoryId: acct['5900'], amount: '1,234.56', date: today }));
    expect(fromDb((await as('officer', (c) => getTransaction(c, t.id)))!.txn.amount)).toBe(123456);
  });
});
