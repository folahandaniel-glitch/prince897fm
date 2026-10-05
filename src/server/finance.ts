import crypto from 'node:crypto';
import {
  accrualLines, budgetStatus, fromDb, isBalanced, MoneyError, naturalBalance, parseMoney, paymentLines, receiptLines, reverseLines, selectBand, sodViolation,
  toDb, transferLines, type Band, type Line,
} from '../domain/finance';
import { localParts, addDays } from '../domain/attendance';
import { can } from '../domain/policy';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import type { Q } from './db';
import { notify } from './hr';

const CUR = `a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)`;
const AP_CODE = '2000';
const d10 = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s: string) => dateRe.test(s) && !Number.isNaN(Date.parse(s));

async function orgInfo(q: Q, orgId: string) {
  return (await q.query<{ timezone: string; currency: string; locale: string }>('select timezone, currency, locale from organizations where id = $1', [orgId]))[0];
}
const wrapMoney = <T,>(fn: () => T): T => { try { return fn(); } catch (e) { if (e instanceof MoneyError) throw new UserError(e.message); throw e; } };

// ---- Chart of accounts and defaults ---------------------------------------------------------------------------------------------
export const DEFAULT_ACCOUNTS: [string, string, 'asset' | 'liability' | 'equity' | 'income' | 'expense', boolean][] = [
  ['1000', 'Cash on hand', 'asset', true], ['1010', 'Bank account', 'asset', true], ['1020', 'Petty cash', 'asset', true],
  ['2000', 'Accounts payable', 'liability', false], ['3000', 'Opening balance equity', 'equity', false],
  ['4000', 'Advertising income', 'income', false], ['4010', 'Sponsorship & partnerships', 'income', false], ['4020', 'Programme & event income', 'income', false], ['4900', 'Other income', 'income', false],
  ['5000', 'Programming & production', 'expense', false], ['5010', 'Engineering & maintenance', 'expense', false], ['5020', 'Utilities & fuel', 'expense', false],
  ['5030', 'Transport & logistics', 'expense', false], ['5040', 'Marketing & promotion', 'expense', false], ['5050', 'Staff costs', 'expense', false],
  ['5060', 'Administration', 'expense', false], ['5900', 'Other expenses', 'expense', false],
];

/** Starter chart, approval bands (editable) and opening balance. Called when an organisation enables finance. */
export async function seedFinanceDefaults(q: Q, orgId: string, byUserId: string, openingBank = 5_000_000_00) {
  const ids: Record<string, string> = {};
  for (const [code, name, type, cash] of DEFAULT_ACCOUNTS) ids[code] = (await q.query<{ id: string }>('insert into fin_accounts (org_id, code, name, type, is_cash) values ($1,$2,$3,$4,$5) returning id', [orgId, code, name, type, cash]))[0].id;
  for (const [min, steps] of [[0, ['finance_manager']], [200_000_00, ['finance_manager', 'ceo']], [2_000_000_00, ['finance_manager', 'ceo', 'executive']]] as const)
    await q.query('insert into fin_approval_bands (org_id, min_amount, steps) values ($1,$2,$3::jsonb)', [orgId, toDb(min), JSON.stringify(steps)]);
  if (openingBank > 0) await postEntry(q, orgId, byUserId, { date: new Date().toISOString().slice(0, 10), memo: 'Opening balance', sourceType: 'opening', lines: [
    { accountId: ids['1010'], debit: openingBank, credit: 0 }, { accountId: ids['3000'], debit: 0, credit: openingBank }] });
  return ids;
}

export async function listAccounts(q: Q) {
  return q.query<any>('select id, code, name, type, is_cash, restricted, active from fin_accounts order by code');
}

export async function addAccount(c: Ctx, i: { code: string; name: string; type: string; isCash?: boolean; restricted?: boolean }) {
  need(c, 'finance:configure');
  if (!/^[0-9]{3,8}$/.test(i.code)) throw new UserError('Account codes are 3 to 8 digits.');
  if (i.name.trim().length < 2) throw new UserError('Enter an account name.');
  if (!['asset', 'liability', 'equity', 'income', 'expense'].includes(i.type)) throw new UserError('Unknown account type.');
  if (i.isCash && i.type !== 'asset') throw new UserError('Only asset accounts can be cash or bank accounts.');
  if ((await c.q.query('select 1 from fin_accounts where code = $1', [i.code]))[0]) throw new UserError(`Account code ${i.code} already exists.`);
  const r = await c.q.query<{ id: string }>('insert into fin_accounts (org_id, code, name, type, is_cash, restricted) values ($1,$2,$3,$4,$5,$6) returning id', [c.orgId, i.code, i.name.trim(), i.type, !!i.isCash, !!i.restricted]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'finance.account_created', entity: 'fin_account', entityId: r[0].id, after: i, ip: c.ip, userAgent: c.userAgent });
}

export async function listBands(q: Q) {
  return (await q.query<any>('select id, min_amount, steps from fin_approval_bands order by min_amount')).map((b) => ({ id: b.id, minAmount: fromDb(b.min_amount), steps: b.steps as string[] }));
}

export async function saveBand(c: Ctx, minAmountText: string, steps: string[]) {
  need(c, 'finance:configure');
  const min = minAmountText.trim() === '0' ? 0 : wrapMoney(() => parseMoney(minAmountText));
  const roles = new Set((await c.q.query<{ key: string }>('select key from roles')).map((r) => r.key));
  if (steps.length === 0) throw new UserError('Choose at least one approver role.');
  for (const s of steps) if (!roles.has(s)) throw new UserError(`Unknown role "${s}".`);
  const existing = (await c.q.query<any>('select id, steps from fin_approval_bands where min_amount = $1', [toDb(min)]))[0];
  if (existing) await c.q.query('update fin_approval_bands set steps = $2::jsonb where id = $1', [existing.id, JSON.stringify(steps)]);
  else await c.q.query('insert into fin_approval_bands (org_id, min_amount, steps) values ($1,$2,$3::jsonb)', [c.orgId, toDb(min), JSON.stringify(steps)]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'finance.approval_band_saved', entity: 'fin_approval_band', before: existing ? { steps: existing.steps } : null, after: { min: toDb(min), steps }, ip: c.ip, userAgent: c.userAgent });
}

// ---- Ledger ---------------------------------------------------------------------------------------------------------------------------
async function periodClosed(q: Q, date: string) {
  const [y, m] = date.split('-').map(Number);
  return !!(await q.query(`select 1 from fin_periods where year = $1 and month = $2 and status = 'closed'`, [y, m]))[0];
}

/** Append a balanced journal entry. Posted entries are immutable; corrections are reversing entries. */
export async function postEntry(q: Q, orgId: string, userId: string, e: { date: string; memo: string; sourceType: string; txnId?: string | null; reversesId?: string | null; lines: Line[] }) {
  if (!isBalanced(e.lines)) throw new UserError('Journal entry is not balanced.');
  if (await periodClosed(q, e.date)) throw new UserError(`The accounting period ${e.date.slice(0, 7)} is closed. Posting is not allowed.`);
  await q.query('select pg_advisory_xact_lock(hashtext($1))', [`journal:${orgId}`]);
  const [{ n }] = await q.query<{ n: string }>('select coalesce(max(entry_no),0)+1 as n from fin_journal_entries');
  const [{ id }] = await q.query<{ id: string }>(
    'insert into fin_journal_entries (org_id, entry_no, entry_date, memo, source_type, txn_id, reverses_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id',
    [orgId, n, e.date, e.memo, e.sourceType, e.txnId ?? null, e.reversesId ?? null, userId]);
  for (const l of e.lines) await q.query('insert into fin_journal_lines (org_id, entry_id, account_id, debit, credit, department_id, branch_id) values ($1,$2,$3,$4,$5,$6,$7)',
    [orgId, id, l.accountId, toDb(l.debit), toDb(l.credit), l.departmentId ?? null, l.branchId ?? null]);
  return { id, entryNo: Number(n) };
}

export async function postManual(c: Ctx, i: { date: string; memo: string; lines: { accountId: string; debit?: string; credit?: string }[] }) {
  need(c, 'finance:configure');
  if (!isDate(i.date)) throw new UserError('Enter a valid date.');
  if (i.memo.trim().length < 10) throw new UserError('Explain the adjustment (at least 10 characters). Manual entries are audited.');
  const lines: Line[] = i.lines.filter((l) => l.accountId && (l.debit || l.credit)).map((l) => ({
    accountId: l.accountId, debit: l.debit ? wrapMoney(() => parseMoney(l.debit!)) : 0, credit: l.credit ? wrapMoney(() => parseMoney(l.credit!)) : 0,
  }));
  if (lines.some((l) => l.debit > 0 && l.credit > 0)) throw new UserError('A line is either a debit or a credit, not both.');
  if (!isBalanced(lines)) throw new UserError('Debits and credits must be equal.');
  for (const l of lines) if (!(await c.q.query('select 1 from fin_accounts where id = $1 and active', [l.accountId]))[0]) throw new UserError('Unknown account.');
  const r = await postEntry(c.q, c.orgId, c.userId, { date: i.date, memo: i.memo.trim(), sourceType: 'manual', lines });
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'finance.manual_entry', entity: 'fin_journal_entry', entityId: r.id, after: { entryNo: r.entryNo, lines: lines.length }, reason: i.memo, ip: c.ip, userAgent: c.userAgent });
  return r.entryNo;
}

export async function setPeriod(c: Ctx, year: number, month: number, close: boolean, reason?: string) {
  need(c, 'finance:configure');
  if (!(month >= 1 && month <= 12 && year >= 2000 && year <= 2100)) throw new UserError('Choose a valid month.');
  if (!close && !reason?.trim()) throw new UserError('A reason is required to reopen a closed period.');
  await c.q.query(`insert into fin_periods (org_id, year, month, status, closed_by, closed_at) values ($1,$2,$3,$4,$5, now()) on conflict (org_id, year, month) do update set status = $4, closed_by = $5, closed_at = now()`,
    [c.orgId, year, month, close ? 'closed' : 'open', c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: close ? 'finance.period_closed' : 'finance.period_reopened', entity: 'fin_period', entityId: `${year}-${month}`, reason, ip: c.ip, userAgent: c.userAgent });
}

export async function listPeriods(q: Q) {
  return q.query<any>('select year, month, status from fin_periods order by year desc, month desc limit 24');
}

export async function cashBalance(q: Q, accountId: string): Promise<number> {
  const r = (await q.query<any>('select coalesce(sum(debit),0) d, coalesce(sum(credit),0) c from fin_journal_lines where account_id = $1', [accountId]))[0];
  return fromDb(r.d) - fromDb(r.c);
}

async function accountByCode(q: Q, code: string) {
  const a = (await q.query<{ id: string }>('select id from fin_accounts where code = $1', [code]))[0];
  if (!a) throw new UserError(`Required account ${code} is missing from the chart of accounts.`);
  return a.id;
}

// ---- Transactions ---------------------------------------------------------------------------------------------------------------------
async function nextNumber(q: Q, orgId: string, kind: string) {
  await q.query('select pg_advisory_xact_lock(hashtext($1))', [`finno:${orgId}`]);
  const prefix = kind === 'expense' ? 'EXP' : kind === 'income' ? 'INC' : 'TRF';
  const r = await q.query<{ n: number }>(`select coalesce(max(substring(number from '[0-9]+$')::int), 0) + 1 as n from fin_transactions where kind = $1`, [kind]);
  return `${prefix}-${String(r[0].n).padStart(5, '0')}`;
}

export interface TxnInput { kind: string; title: string; description?: string; partyId?: string | null; categoryId: string; cashAccountId?: string | null; amount: string; date: string; departmentId?: string | null; branchId?: string | null; submit?: boolean }

export async function createTransaction(c: Ctx, i: TxnInput) {
  need(c, 'finance:create', { departmentId: i.departmentId ?? null, branchId: i.branchId ?? null });
  if (!['expense', 'income', 'transfer'].includes(i.kind)) throw new UserError('Unknown transaction type.');
  if (i.title.trim().length < 3) throw new UserError('Give the transaction a clear title.');
  if (!isDate(i.date)) throw new UserError('Enter a valid date.');
  const amount = wrapMoney(() => parseMoney(i.amount));
  const cat = (await c.q.query<any>('select id, type, is_cash from fin_accounts where id = $1 and active', [i.categoryId]))[0];
  if (!cat) throw new UserError('Choose a category account.');
  if (i.kind === 'expense' && cat.type !== 'expense') throw new UserError('Expenses must use an expense category.');
  if (i.kind === 'income' && cat.type !== 'income') throw new UserError('Income must use an income category.');
  if (i.kind === 'transfer' && !cat.is_cash) throw new UserError('A transfer destination must be a cash or bank account.');
  let cash: any = null;
  if (i.cashAccountId) {
    cash = (await c.q.query<any>('select id, is_cash from fin_accounts where id = $1 and active', [i.cashAccountId]))[0];
    if (!cash || !cash.is_cash) throw new UserError('Choose a cash or bank account.');
  }
  if (i.kind === 'income' && !cash) throw new UserError('Choose the cash or bank account that received the money.');
  if (i.kind === 'transfer' && !cash) throw new UserError('Choose the account the money leaves.');
  if (i.kind === 'transfer' && cash.id === cat.id) throw new UserError('A transfer needs two different accounts.');
  for (const [t, v, l] of [['fin_parties', i.partyId, 'party'], ['departments', i.departmentId, 'department'], ['branches', i.branchId, 'branch']] as const)
    if (v && !(await c.q.query(`select 1 from ${t} where id = $1`, [v]))[0]) throw new UserError(`Unknown ${l}.`);
  const number = await nextNumber(c.q, c.orgId, i.kind);
  const r = await c.q.query<{ id: string }>(
    `insert into fin_transactions (org_id, kind, number, title, description, party_id, category_account_id, cash_account_id, amount, currency, txn_date, department_id, branch_id, status, created_by, submitted_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,(select currency from organizations where id = $1),$10,$11,$12,$13,$14, $15) returning id`,
    [c.orgId, i.kind, number, i.title.trim(), i.description?.trim() || null, i.partyId || null, i.categoryId, i.cashAccountId || null, toDb(amount), i.date, i.departmentId || null, i.branchId || null, i.submit ? 'submitted' : 'draft', c.userId, i.submit ? new Date() : null]);
  if (i.submit) await c.q.query(`insert into fin_approvals (org_id, txn_id, action, actor_user_id) values ($1,$2,'submitted',$3)`, [c.orgId, r[0].id, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'finance.transaction_created', entity: 'fin_transaction', entityId: r[0].id, after: { number, kind: i.kind, amount: toDb(amount), status: i.submit ? 'submitted' : 'draft' }, ip: c.ip, userAgent: c.userAgent });
  if (i.submit) await notifyRole(c.q, c.orgId, 'accountant', 'Transaction awaiting review', `${number}: ${i.title.trim()}`, `/finance/${r[0].id}`);
  return { id: r[0].id, number };
}

async function loadTxn(c: Ctx, id: string, lock = false) {
  const t = (await c.q.query<any>(`select * from fin_transactions where id = $1 ${lock ? 'for update' : ''}`, [id]))[0];
  if (!t) throw new UserError('Transaction not found.');
  return t;
}
async function trail(q: Q, t: any) {
  const approvers = (await q.query<{ actor_user_id: string }>(`select actor_user_id from fin_approvals where txn_id = $1 and action = 'approved'`, [t.id])).map((r) => r.actor_user_id);
  return { creator: t.created_by as string, reviewer: t.reviewed_by as string | null, approvers, payer: (t.paid_by ?? t.reviewed_by) as string | null };
}
const log = (c: Ctx, txnId: string, action: string, note?: string | null, step?: number) =>
  c.q.query('insert into fin_approvals (org_id, txn_id, action, step, actor_user_id, note) values ($1,$2,$3,$4,$5,$6)', [c.orgId, txnId, action, step ?? null, c.userId, note?.trim() || null]);

async function notifyRole(q: Q, orgId: string, roleKey: string, title: string, body: string, href: string, exclude?: string) {
  const users = await q.query<{ user_id: string }>(`select distinct ur.user_id from user_roles ur join roles r on r.id = ur.role_id where r.key = $1 and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date) limit 20`, [roleKey]);
  for (const u of users) if (u.user_id !== exclude) await notify(q, orgId, u.user_id, title, body, href);
}

export async function submitDraft(c: Ctx, id: string) {
  const t = await loadTxn(c, id, true);
  if (t.created_by !== c.userId) throw new UserError('Only the person who created this can submit it.');
  if (t.status !== 'draft') throw new UserError('Only drafts can be submitted.');
  await c.q.query(`update fin_transactions set status = 'submitted', submitted_at = now() where id = $1`, [id]);
  await log(c, id, 'submitted');
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'finance.submitted', entity: 'fin_transaction', entityId: id, before: { status: 'draft' }, after: { status: 'submitted' }, ip: c.ip, userAgent: c.userAgent });
  await notifyRole(c.q, c.orgId, 'accountant', 'Transaction awaiting review', `${t.number}: ${t.title}`, `/finance/${id}`);
}

export async function reviewTransaction(c: Ctx, id: string, decision: 'approve' | 'return' | 'reject', note: string) {
  need(c, 'finance:review');
  const t = await loadTxn(c, id, true);
  if (t.status !== 'submitted') throw new UserError('This transaction is not waiting for review.');
  const v = sodViolation(c.userId, 'review', await trail(c.q, t));
  if (v) throw new UserError(v);
  if (decision !== 'approve' && !note.trim()) throw new UserError('Please give a reason.');
  const amount = fromDb(t.amount);
  if (decision === 'return') { await c.q.query(`update fin_transactions set status = 'draft' where id = $1`, [id]); await log(c, id, 'returned', note); }
  else if (decision === 'reject') { await c.q.query(`update fin_transactions set status = 'rejected' where id = $1`, [id]); await log(c, id, 'rejected', note); }
  else if (t.kind === 'income') {
    await postEntry(c.q, c.orgId, c.userId, { date: d10(t.txn_date), memo: `${t.number} ${t.title}`, sourceType: 'income', txnId: id,
      lines: receiptLines({ cashId: t.cash_account_id, incomeId: t.category_account_id, amount, departmentId: t.department_id, branchId: t.branch_id }) });
    await c.q.query(`update fin_transactions set status = 'posted', reviewed_by = $2, reviewed_at = now() where id = $1`, [id, c.userId]);
    await log(c, id, 'reviewed', note);
  } else {
    const bands: Band[] = (await listBands(c.q)).map((b) => ({ minAmount: b.minAmount, steps: b.steps }));
    const band = selectBand(amount, bands);
    if (!band) throw new UserError('No approval band covers this amount. Ask the Finance Manager to configure approval bands.');
    await c.q.query(`update fin_transactions set status = 'reviewed', reviewed_by = $2, reviewed_at = now(), approval_steps = $3::jsonb, approval_index = 0 where id = $1`, [id, c.userId, JSON.stringify(band.steps)]);
    await log(c, id, 'reviewed', note);
    await notifyRole(c.q, c.orgId, band.steps[0], 'Payment awaiting your approval', `${t.number}: ${t.title}`, `/finance/${id}`, c.userId);
  }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: `finance.review_${decision}`, entity: 'fin_transaction', entityId: id, before: { status: t.status }, reason: note || undefined, ip: c.ip, userAgent: c.userAgent });
  if (decision !== 'approve') await notify(c.q, c.orgId, t.created_by, `Your transaction was ${decision === 'return' ? 'returned' : 'rejected'}`, `${t.number}: ${note}`, `/finance/${id}`);
}

function holdsRole(c: Ctx, roleKey: string) {
  const today = new Date().toISOString().slice(0, 10);
  return c.subject.grants.some((g) => g.roleKey === roleKey && g.validFrom <= today && (!g.validTo || g.validTo >= today));
}

export async function approveTransaction(c: Ctx, id: string, decision: 'approve' | 'reject', note: string) {
  need(c, 'finance:approve');
  const t = await loadTxn(c, id, true);
  if (t.status !== 'reviewed') throw new UserError('This transaction is not waiting for approval.');
  const steps: string[] = t.approval_steps;
  const required = steps[t.approval_index];
  if (!required || !holdsRole(c, required)) throw new UserError(`This stage needs the ${required ?? 'configured'} role.`);
  const v = sodViolation(c.userId, 'approve', await trail(c.q, t));
  if (v) throw new UserError(v);
  if (decision === 'reject') {
    if (!note.trim()) throw new UserError('Please explain why you are rejecting.');
    await c.q.query(`update fin_transactions set status = 'rejected' where id = $1`, [id]);
    await log(c, id, 'rejected', note, t.approval_index);
    await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'finance.approval_rejected', entity: 'fin_transaction', entityId: id, reason: note, ip: c.ip, userAgent: c.userAgent });
    await notify(c.q, c.orgId, t.created_by, 'Your transaction was rejected', `${t.number}: ${note}`, `/finance/${id}`);
    return 'rejected';
  }
  await log(c, id, 'approved', note, t.approval_index);
  const next = t.approval_index + 1;
  let status = 'reviewed';
  if (next >= steps.length) {
    status = 'approved';
    if (t.kind === 'expense') {
      const ap = await accountByCode(c.q, AP_CODE);
      await postEntry(c.q, c.orgId, c.userId, { date: d10(t.txn_date), memo: `${t.number} ${t.title} (approved)`, sourceType: 'expense', txnId: id,
        lines: accrualLines({ categoryId: t.category_account_id, apId: ap, amount: fromDb(t.amount), departmentId: t.department_id, branchId: t.branch_id }) });
    }
    await c.q.query(`update fin_transactions set status = 'approved', approval_index = $2, approved_at = now() where id = $1`, [id, next]);
    await notifyRole(c.q, c.orgId, 'finance_officer', 'Approved: ready for payment', `${t.number}: ${t.title}`, `/finance/${id}`, c.userId);
  } else {
    await c.q.query('update fin_transactions set approval_index = $2 where id = $1', [id, next]);
    await notifyRole(c.q, c.orgId, steps[next], 'Payment awaiting your approval', `${t.number}: ${t.title}`, `/finance/${id}`, c.userId);
  }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'finance.approved', entity: 'fin_transaction', entityId: id, before: { status: t.status, stage: t.approval_index }, after: { status, stage: next }, reason: note || undefined, ip: c.ip, userAgent: c.userAgent });
  return status;
}

export async function payTransaction(c: Ctx, id: string, i: { cashAccountId: string; reference: string }) {
  need(c, 'finance:pay');
  const t = await loadTxn(c, id, true);
  if (t.status !== 'approved') throw new UserError('Only approved transactions can be paid.');
  const v = sodViolation(c.userId, 'pay', await trail(c.q, t));
  if (v) throw new UserError(v);
  if (!i.reference.trim()) throw new UserError('Enter the payment reference (receipt, transfer or cheque number).');
  const acct = (await c.q.query<any>('select id, name, is_cash from fin_accounts where id = $1 and active', [i.cashAccountId]))[0];
  if (!acct?.is_cash) throw new UserError('Choose the cash or bank account the money is paid from.');
  if (t.kind === 'transfer' && acct.id === t.category_account_id) throw new UserError('Source and destination must be different accounts.');
  const amount = fromDb(t.amount);
  const bal = await cashBalance(c.q, acct.id);
  if (bal < amount) throw new UserError(`Insufficient funds in ${acct.name}: available ${toDb(bal)}, needed ${toDb(amount)}.`);
  const date = new Date().toISOString().slice(0, 10);
  if (t.kind === 'expense') {
    const ap = await accountByCode(c.q, AP_CODE);
    await postEntry(c.q, c.orgId, c.userId, { date, memo: `${t.number} payment`, sourceType: 'expense', txnId: id, lines: paymentLines({ apId: ap, cashId: acct.id, amount, departmentId: t.department_id, branchId: t.branch_id }) });
  } else {
    await postEntry(c.q, c.orgId, c.userId, { date, memo: `${t.number} transfer`, sourceType: 'transfer', txnId: id, lines: transferLines({ fromId: acct.id, toId: t.category_account_id, amount }) });
  }
  await c.q.query(`update fin_transactions set status = 'paid', paid_by = $2, paid_at = now(), payment_ref = $3, cash_account_id = $4 where id = $1`, [id, c.userId, i.reference.trim(), acct.id]);
  await log(c, id, 'paid', i.reference);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'finance.paid', entity: 'fin_transaction', entityId: id, before: { status: t.status }, after: { status: 'paid', account: acct.name, reference: i.reference, amount: toDb(amount) }, ip: c.ip, userAgent: c.userAgent });
  await notifyRole(c.q, c.orgId, 'accountant', 'Payment recorded: please reconcile', `${t.number}: ${t.title}`, `/finance/${id}`, c.userId);
  await notify(c.q, c.orgId, t.created_by, 'Your transaction was paid', `${t.number}: ${t.title}`, `/finance/${id}`);
}

export async function reconcileTransaction(c: Ctx, id: string, statementRef: string) {
  need(c, 'finance:reconcile');
  const t = await loadTxn(c, id, true);
  if (!['paid', 'posted'].includes(t.status)) throw new UserError('Only paid or posted transactions can be reconciled.');
  const v = sodViolation(c.userId, 'reconcile', await trail(c.q, t));
  if (v) throw new UserError(v);
  if (!statementRef.trim()) throw new UserError('Enter the bank statement line or reference you matched this to.');
  await c.q.query(`update fin_transactions set status = 'reconciled', reconciled_by = $2, reconciled_at = now(), statement_ref = $3 where id = $1`, [id, c.userId, statementRef.trim()]);
  await log(c, id, 'reconciled', statementRef);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'finance.reconciled', entity: 'fin_transaction', entityId: id, before: { status: t.status }, after: { status: 'reconciled', statement: statementRef }, ip: c.ip, userAgent: c.userAgent });
}

/** Void = reverse every journal entry of the transaction (mirror entries) and mark it void. Nothing is deleted. */
export async function voidTransaction(c: Ctx, id: string, reason: string) {
  need(c, 'finance:reverse');
  const t = await loadTxn(c, id, true);
  if (!['approved', 'paid', 'posted', 'reconciled'].includes(t.status)) throw new UserError('Only approved, paid or posted transactions can be voided. Reject or return earlier ones instead.');
  if (reason.trim().length < 10) throw new UserError('Explain why this is being voided (at least 10 characters).');
  const entries = await c.q.query<any>(`select e.id, e.entry_date::text as d, e.memo from fin_journal_entries e where e.txn_id = $1 and e.reverses_id is null and not exists (select 1 from fin_journal_entries r where r.reverses_id = e.id)`, [id]);
  const date = new Date().toISOString().slice(0, 10);
  for (const e of entries) {
    const lines = (await c.q.query<any>('select account_id, debit, credit, department_id, branch_id from fin_journal_lines where entry_id = $1', [e.id]))
      .map((l): Line => ({ accountId: l.account_id, debit: fromDb(l.debit), credit: fromDb(l.credit), departmentId: l.department_id, branchId: l.branch_id }));
    await postEntry(c.q, c.orgId, c.userId, { date, memo: `Reversal of: ${e.memo}`, sourceType: 'reversal', txnId: id, reversesId: e.id, lines: reverseLines(lines) });
  }
  await c.q.query(`update fin_transactions set status = 'void', void_reason = $2, voided_by = $3, voided_at = now() where id = $1`, [id, reason.trim(), c.userId]);
  await log(c, id, 'voided', reason);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'finance.voided', entity: 'fin_transaction', entityId: id, before: { status: t.status }, after: { status: 'void', reversedEntries: entries.length }, reason, ip: c.ip, userAgent: c.userAgent });
  await notify(c.q, c.orgId, t.created_by, 'A transaction was voided', `${t.number}: ${reason}`, `/finance/${id}`);
}

// ---- Attachments -----------------------------------------------------------------------------------------------------------------------------
function sniff(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return { mime: 'application/pdf', ext: 'pdf' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  return null;
}

export async function addAttachment(c: Ctx, txnId: string, filename: string, data: Buffer) {
  const t = await loadTxn(c, txnId);
  if (!(t.created_by === c.userId || can(c.subject, 'finance:review').allow || can(c.subject, 'finance:approve').allow || can(c.subject, 'finance:pay').allow)) throw new UserError('You cannot add documents to this transaction.');
  if (['void', 'rejected'].includes(t.status)) throw new UserError('This transaction is closed to new documents.');
  if (data.length === 0 || data.length > 2 * 1024 * 1024) throw new UserError('Files must be between 1 byte and 2 MB.');
  const kind = sniff(data); // trust the file's bytes, not its name or the browser-declared type
  if (!kind) throw new UserError('Only PDF, PNG or JPEG files are accepted.');
  const safe = filename.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || `document.${kind.ext}`;
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  const r = await c.q.query<{ id: string }>('insert into fin_attachments (org_id, txn_id, filename, mime, size_bytes, sha256, data, uploaded_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id', [c.orgId, txnId, safe, kind.mime, data.length, sha, data, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'finance.document_added', entity: 'fin_transaction', entityId: txnId, after: { file: safe, sha256: sha, bytes: data.length }, ip: c.ip, userAgent: c.userAgent });
  return r[0].id;
}

export async function getAttachment(c: Ctx, id: string) {
  const a = (await c.q.query<any>('select a.*, t.created_by, t.department_id, t.branch_id from fin_attachments a join fin_transactions t on t.id = a.txn_id where a.id = $1', [id]))[0];
  if (!a) return null;
  if (a.created_by !== c.userId) need(c, 'finance:view', { departmentId: a.department_id, branchId: a.branch_id });
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'finance.document_viewed', entity: 'fin_attachment', entityId: id, ip: c.ip, userAgent: c.userAgent });
  const sha = crypto.createHash('sha256').update(a.data).digest('hex');
  if (sha !== a.sha256) throw new UserError('Integrity check failed: this document does not match its recorded fingerprint.');
  return { filename: a.filename as string, mime: a.mime as string, data: a.data as Buffer };
}

// ---- Reading --------------------------------------------------------------------------------------------------------------------------------------
const VIEW = `select t.id, t.number, t.kind, t.title, t.status, t.amount, t.txn_date::text as d, t.created_by, t.department_id, t.branch_id, t.approval_index, t.approval_steps,
  p.name as party, cat.name as category, cu.email as creator, dep.name as department
  from fin_transactions t left join fin_parties p on p.id = t.party_id join fin_accounts cat on cat.id = t.category_account_id join users cu on cu.id = t.created_by left join departments dep on dep.id = t.department_id`;

function visible(c: Ctx, rows: any[]) {
  return rows.filter((r) => r.created_by === c.userId || can(c.subject, 'finance:view', { departmentId: r.department_id, branchId: r.branch_id }).allow);
}

export async function listTransactions(c: Ctx, f: { status?: string; kind?: string; q?: string; mine?: boolean; limit?: number } = {}) {
  const where: string[] = []; const params: unknown[] = [];
  if (f.status) { params.push(f.status); where.push(`t.status = $${params.length}`); }
  if (f.kind) { params.push(f.kind); where.push(`t.kind = $${params.length}`); }
  if (f.q) { params.push(`%${f.q.toLowerCase()}%`); where.push(`(lower(t.title) like $${params.length} or lower(t.number) like $${params.length})`); }
  if (f.mine) { params.push(c.userId); where.push(`t.created_by = $${params.length}`); }
  const rows = await c.q.query<any>(`${VIEW} ${where.length ? 'where ' + where.join(' and ') : ''} order by t.created_at desc limit ${Math.min(f.limit ?? 100, 500)}`, params);
  return visible(c, rows).map((r) => ({ ...r, amountMinor: fromDb(r.amount) }));
}

export async function getTransaction(c: Ctx, id: string) {
  const t = (await c.q.query<any>(`${VIEW.replace('select t.id,', 'select t.*, t.id,')} where t.id = $1`, [id]))[0];
  if (!t) return null;
  if (t.created_by !== c.userId) need(c, 'finance:view', { departmentId: t.department_id, branchId: t.branch_id });
  const [approvals, entries, files, cash] = await Promise.all([
    c.q.query<any>(`select a.action, a.step, a.note, a.created_at, a.actor_user_id, u.email as actor from fin_approvals a join users u on u.id = a.actor_user_id where a.txn_id = $1 order by a.id`, [id]),
    c.q.query<any>(`select e.id, e.entry_no, e.entry_date::text as d, e.memo, e.source_type,
      (select json_agg(json_build_object('code', ac.code, 'name', ac.name, 'debit', l.debit, 'credit', l.credit) order by l.id) from fin_journal_lines l join fin_accounts ac on ac.id = l.account_id where l.entry_id = e.id) as lines
      from fin_journal_entries e where e.txn_id = $1 order by e.entry_no`, [id]),
    c.q.query<any>('select id, filename, mime, size_bytes, sha256, created_at from fin_attachments where txn_id = $1 order by created_at', [id]),
    t.cash_account_id ? c.q.query<any>('select name from fin_accounts where id = $1', [t.cash_account_id]) : Promise.resolve([]),
  ]);
  return { txn: { ...t, amountMinor: fromDb(t.amount), cashAccount: cash[0]?.name ?? null }, approvals, entries, files };
}

export async function workQueues(c: Ctx) {
  const mine = c.userId;
  const rows = await c.q.query<any>(`${VIEW.replace('select t.id,', 'select t.reviewed_by, t.paid_by, t.id,')} where t.status in ('submitted','reviewed','approved','paid','posted') order by t.created_at`);
  const out = { review: [] as any[], approve: [] as any[], pay: [] as any[], reconcile: [] as any[] };
  for (const r of visible(c, rows)) {
    r.amountMinor = fromDb(r.amount);
    const ap = r.status === 'reviewed' ? (await c.q.query<{ actor_user_id: string }>(`select actor_user_id from fin_approvals where txn_id = $1 and action = 'approved'`, [r.id])).map((x) => x.actor_user_id) : [];
    const tr = { creator: r.created_by, reviewer: r.reviewed_by, approvers: ap, payer: r.paid_by ?? r.reviewed_by };
    if (r.status === 'submitted' && can(c.subject, 'finance:review').allow && !sodViolation(mine, 'review', tr)) out.review.push(r);
    if (r.status === 'reviewed' && can(c.subject, 'finance:approve').allow && holdsRole(c, (r.approval_steps as string[])[r.approval_index]) && !sodViolation(mine, 'approve', tr)) out.approve.push(r);
    if (r.status === 'approved' && can(c.subject, 'finance:pay').allow && !sodViolation(mine, 'pay', { ...tr, approvers: (await c.q.query<{ actor_user_id: string }>(`select actor_user_id from fin_approvals where txn_id = $1 and action = 'approved'`, [r.id])).map((x) => x.actor_user_id) })) out.pay.push(r);
    if (['paid', 'posted'].includes(r.status) && can(c.subject, 'finance:reconcile').allow && !sodViolation(mine, 'reconcile', tr)) out.reconcile.push(r);
  }
  return out;
}

export async function addParty(c: Ctx, kind: 'vendor' | 'client', name: string, phone?: string, email?: string) {
  need(c, 'finance:create');
  if (name.trim().length < 2) throw new UserError('Enter a name.');
  if ((await c.q.query('select 1 from fin_parties where kind = $1 and lower(name) = lower($2)', [kind, name.trim()]))[0]) throw new UserError('That name already exists.');
  await c.q.query('insert into fin_parties (org_id, kind, name, phone, email) values ($1,$2,$3,$4,$5)', [c.orgId, kind, name.trim(), phone || null, email || null]);
}
export const listParties = (q: Q) => q.query<any>('select id, kind, name from fin_parties where active order by name');

// ---- Ledger views and reports ---------------------------------------------------------------------------------------------------------
export async function trialBalance(c: Ctx, asOf?: string) {
  need(c, 'finance:view');
  const rows = await c.q.query<any>(
    `select a.code, a.name, a.type, coalesce(sum(x.debit),0) d, coalesce(sum(x.credit),0) c from fin_accounts a
       left join (select l.account_id, l.debit, l.credit from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where $1::date is null or e.entry_date <= $1::date) x on x.account_id = a.id
      group by a.code, a.name, a.type order by a.code`, [asOf ?? null]);
  const lines = rows.map((r) => ({ code: r.code, name: r.name, type: r.type, debit: fromDb(r.d), credit: fromDb(r.c), balance: naturalBalance(r.type, fromDb(r.d), fromDb(r.c)) }));
  return { lines, totalDebit: lines.reduce((s, l) => s + l.debit, 0), totalCredit: lines.reduce((s, l) => s + l.credit, 0) };
}

export async function ledger(c: Ctx, accountId?: string, limit = 200) {
  need(c, 'finance:view');
  return c.q.query<any>(
    `select e.entry_no, e.entry_date::text as d, e.memo, e.source_type, a.code, a.name, l.debit, l.credit, t.number as txn_number, t.id as txn_id from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id
       join fin_accounts a on a.id = l.account_id left join fin_transactions t on t.id = e.txn_id where ($1::uuid is null or l.account_id = $1::uuid) order by e.entry_no desc, l.id limit ${Math.min(limit, 1000)}`, [accountId ?? null]);
}

/** Income/expense (net) per account between two dates, optionally by department. */
export async function incomeExpense(c: Ctx, from: string, to: string) {
  need(c, 'finance:view');
  if (!isDate(from) || !isDate(to)) throw new UserError('Enter valid dates.');
  const rows = await c.q.query<any>(
    `select a.code, a.name, a.type, coalesce(sum(l.debit),0) d, coalesce(sum(l.credit),0) c from fin_accounts a join fin_journal_lines l on l.account_id = a.id join fin_journal_entries e on e.id = l.entry_id
      where a.type in ('income','expense') and e.entry_date between $1::date and $2::date group by a.code, a.name, a.type order by a.code`, [from, to]);
  const lines = rows.map((r) => ({ code: r.code, name: r.name, type: r.type, amount: naturalBalance(r.type, fromDb(r.d), fromDb(r.c)) }));
  const income = lines.filter((l) => l.type === 'income').reduce((s, l) => s + l.amount, 0), expense = lines.filter((l) => l.type === 'expense').reduce((s, l) => s + l.amount, 0);
  return { lines, income, expense, net: income - expense };
}

export async function setBudget(c: Ctx, i: { year: number; accountId: string; departmentId?: string | null; amount: string }) {
  need(c, 'finance:configure');
  const amount = wrapMoney(() => parseMoney(i.amount));
  const acct = (await c.q.query<any>(`select id from fin_accounts where id = $1 and type = 'expense'`, [i.accountId]))[0];
  if (!acct) throw new UserError('Budgets are set against expense accounts.');
  if (!(i.year >= 2000 && i.year <= 2100)) throw new UserError('Enter a valid year.');
  const ex = (await c.q.query<any>(`select id, amount from fin_budgets where year = $1 and account_id = $2 and coalesce(department_id,'00000000-0000-0000-0000-000000000000'::uuid) = coalesce($3::uuid,'00000000-0000-0000-0000-000000000000'::uuid)`, [i.year, i.accountId, i.departmentId || null]))[0];
  if (ex) await c.q.query('update fin_budgets set amount = $2, approved_by = $3 where id = $1', [ex.id, toDb(amount), c.userId]);
  else await c.q.query('insert into fin_budgets (org_id, year, account_id, department_id, amount, approved_by, created_by) values ($1,$2,$3,$4,$5,$6,$6)', [c.orgId, i.year, i.accountId, i.departmentId || null, toDb(amount), c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'finance.budget_set', entity: 'fin_budget', before: ex ? { amount: ex.amount } : null, after: { year: i.year, account: i.accountId, department: i.departmentId, amount: toDb(amount) }, ip: c.ip, userAgent: c.userAgent });
}

export async function budgetVsActual(c: Ctx, year: number) {
  need(c, 'finance:view');
  const rows = await c.q.query<any>(
    `select b.id, a.code, a.name, d.name as department, b.amount,
            coalesce((select sum(l.debit - l.credit) from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where l.account_id = b.account_id and extract(year from e.entry_date) = b.year
                       and (b.department_id is null or l.department_id = b.department_id)), 0) as spent
       from fin_budgets b join fin_accounts a on a.id = b.account_id left join departments d on d.id = b.department_id where b.year = $1 order by a.code, d.name nulls first`, [year]);
  return rows.map((r) => { const budget = fromDb(r.amount), spent = fromDb(r.spent); return { id: r.id, code: r.code, account: r.name, department: r.department, budget, spent, remaining: budget - spent, ...budgetStatus(spent, budget) }; });
}

// ---- Executive financial centre -------------------------------------------------------------------------------------------------------
export async function financeOverview(c: Ctx) {
  need(c, 'finance:oversee');
  const info = await orgInfo(c.q, c.orgId);
  const today = localParts(new Date(), info.timezone).date;
  const mondayOffset = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const ranges = { today: [today, today], week: [addDays(today, -mondayOffset), today], month: [`${today.slice(0, 7)}-01`, today], year: [`${today.slice(0, 4)}-01-01`, today] } as const;
  const periods: Record<string, { income: number; expense: number }> = {};
  for (const [k, [a, b]] of Object.entries(ranges)) { const r = await incomeExpense(c, a, b); periods[k] = { income: r.income, expense: r.expense }; }

  const accts = await c.q.query<any>(`select a.id, a.code, a.name, a.type, a.is_cash, a.restricted, coalesce(sum(l.debit),0) d, coalesce(sum(l.credit),0) c from fin_accounts a left join fin_journal_lines l on l.account_id = a.id group by a.id order by a.code`);
  const bal = (r: any) => naturalBalance(r.type, fromDb(r.d), fromDb(r.c));
  const cashAccts = accts.filter((a) => a.is_cash).map((a) => ({ name: a.name, balance: bal(a), restricted: a.restricted }));
  const available = cashAccts.filter((a) => !a.restricted).reduce((s, a) => s + a.balance, 0), restricted = cashAccts.filter((a) => a.restricted).reduce((s, a) => s + a.balance, 0);
  const payables = accts.filter((a) => a.code === AP_CODE).reduce((s, a) => s + bal(a), 0);

  const byCategory = await c.q.query<any>(`select a.name, sum(l.debit - l.credit) amt from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id join fin_accounts a on a.id = l.account_id where a.type = 'expense' and e.entry_date between $1::date and $2::date group by a.name having sum(l.debit - l.credit) <> 0 order by amt desc limit 8`, [...ranges.month]);
  const byDept = await c.q.query<any>(`select coalesce(d.name,'Unallocated') name, sum(l.debit - l.credit) amt from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id join fin_accounts a on a.id = l.account_id left join departments d on d.id = l.department_id where a.type = 'expense' and e.entry_date between $1::date and $2::date group by 1 having sum(l.debit - l.credit) <> 0 order by amt desc limit 8`, [...ranges.month]);
  const trend = await c.q.query<any>(`select to_char(date_trunc('month', e.entry_date), 'YYYY-MM') m, sum(case when a.type='income' then l.credit - l.debit else 0 end) inc, sum(case when a.type='expense' then l.debit - l.credit else 0 end) exp
    from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id join fin_accounts a on a.id = l.account_id where a.type in ('income','expense') and e.entry_date >= date_trunc('month', $1::date) - interval '5 months' group by 1 order by 1`, [today]);
  const [pend] = await c.q.query<any>(`select count(*) filter (where status in ('submitted'))::int review, count(*) filter (where status = 'reviewed')::int approval, count(*) filter (where status = 'approved')::int to_pay, coalesce(sum(amount) filter (where status in ('submitted','reviewed','approved')),0) pending_value from fin_transactions`);
  const bands = await listBands(c.q);
  const top = bands.length ? bands[bands.length - 1].minAmount : 0;
  const big = top > 0 ? await c.q.query<any>(`${VIEW} where t.amount >= $1 and t.status not in ('draft','rejected','void') order by t.created_at desc limit 8`, [toDb(top)]) : [];

  // Exception rules (advisory flags for a human to look at, never automatic action).
  const exceptions: { text: string; id?: string }[] = [];
  const dup = await c.q.query<any>(`select a.id, a.number, b.number n2 from fin_transactions a join fin_transactions b on b.id > a.id and b.kind = a.kind and b.amount = a.amount and coalesce(b.party_id,'00000000-0000-0000-0000-000000000000'::uuid) = coalesce(a.party_id,'00000000-0000-0000-0000-000000000000'::uuid) and b.party_id is not null and abs(b.txn_date - a.txn_date) <= 7 where a.status not in ('rejected','void') and b.status not in ('rejected','void') limit 5`);
  for (const d of dup) exceptions.push({ text: `Possible duplicate: ${d.number} and ${d.n2} (same vendor, same amount, within 7 days).`, id: d.id });
  for (const b of bands.filter((x) => x.minAmount > 0)) {
    const near = await c.q.query<any>(`select id, number from fin_transactions where kind = 'expense' and amount >= $1 and amount < $2 and status not in ('rejected','void') limit 3`, [toDb(Math.floor(b.minAmount * 0.95)), toDb(b.minAmount)]);
    for (const n of near) exceptions.push({ text: `${n.number} is just below the ${toDb(b.minAmount)} approval threshold.`, id: n.id });
  }
  const wk = await c.q.query<any>(`select id, number from fin_transactions where paid_at is not null and extract(dow from paid_at at time zone $1) in (0,6) and paid_at > now() - interval '30 days' limit 3`, [info.timezone]);
  for (const w of wk) exceptions.push({ text: `${w.number} was paid on a weekend.`, id: w.id });
  const voided = (await c.q.query<any>(`select count(*)::int n from fin_transactions where status = 'void' and voided_at > now() - interval '30 days'`))[0].n;
  if (voided > 0) exceptions.push({ text: `${voided} transaction(s) voided in the last 30 days.` });
  const budgets = (await budgetVsActual(c, Number(today.slice(0, 4)))).filter((b) => b.level !== 'ok');

  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'finance.overview_viewed', entity: 'dashboard', ip: c.ip, userAgent: c.userAgent });
  return { today, currency: info.currency, locale: info.locale, periods, cashAccts, available, restricted, payables, net: available - payables, byCategory: byCategory.map((r) => ({ name: r.name, amount: fromDb(r.amt) })), byDept: byDept.map((r) => ({ name: r.name, amount: fromDb(r.amt) })),
    trend: trend.map((r) => ({ month: r.m, income: fromDb(r.inc), expense: fromDb(r.exp) })), pending: { review: pend.review, approval: pend.approval, toPay: pend.to_pay, value: fromDb(pend.pending_value) }, big: big.map((r: any) => ({ ...r, amountMinor: fromDb(r.amount) })), exceptions, budgets };
}

/** CSV of the transaction register (formula-injection safe). Export is audited. */
export async function registerCsv(c: Ctx, from: string, to: string) {
  need(c, 'finance:export');
  if (!isDate(from) || !isDate(to)) throw new UserError('Enter valid dates.');
  const rows = await c.q.query<any>(`${VIEW} where t.txn_date between $1::date and $2::date order by t.txn_date, t.number`, [from, to]);
  const esc = (v: unknown) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  const out = ['Number,Date,Type,Title,Party,Category,Department,Amount,Status,Created by'];
  for (const r of rows) out.push([r.number, r.d, r.kind, r.title, r.party, r.category, r.department, r.amount, r.status, r.creator].map(esc).join(','));
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'finance.exported', entity: 'fin_transaction', after: { report: 'register', from, to, rows: rows.length }, ip: c.ip, userAgent: c.userAgent });
  return out.join('\r\n');
}

/** Find an account by code, creating it when missing (used by modules that post to the ledger, e.g. payroll). */
export async function ensureAccount(q: Q, orgId: string, code: string, name: string, type: 'asset' | 'liability' | 'equity' | 'income' | 'expense') {
  const e = (await q.query<{ id: string }>('select id from fin_accounts where code = $1', [code]))[0];
  if (e) return e.id;
  return (await q.query<{ id: string }>('insert into fin_accounts (org_id, code, name, type) values ($1,$2,$3,$4) returning id', [orgId, code, name, type]))[0].id;
}
