import { ageingBucket, AGEING_BUCKETS, invoiceLines, parseBankCsv, settlementLines, suggestMatch, vatOn, whtOn, type AccountIds, type Candidate, type InvoiceKind } from '../domain/invoices';
import { fromDb, MoneyError, parseMoney, reverseLines, selectBand, toDb, type Line } from '../domain/finance';
import { can } from '../domain/policy';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import type { Q } from './db';
import { cashBalance, ensureAccount, listBands, postEntry, reconcileTransaction } from './finance';
import { notify } from './hr';

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const today = () => new Date().toISOString().slice(0, 10);
const money = (s: string) => { try { return parseMoney(s); } catch (e) { if (e instanceof MoneyError) throw new UserError(e.message); throw e; } };
const moneyOrZero = (s: string) => (s.trim() === '' || Number(s.replace(/,/g, '')) === 0 ? 0 : money(s));

// ---- Settings and accounts ----------------------------------------------------------------------------------------------------------------------
export async function getTaxSettings(q: Q) {
  const r = (await q.query<any>('select vat_rate, wht_rate from fin_settings'))[0];
  return { vatRate: Number(r?.vat_rate ?? 7.5), whtRate: Number(r?.wht_rate ?? 5) };
}
export async function saveTaxSettings(c: Ctx, vat: number, wht: number) {
  need(c, 'finance:configure');
  if (!(vat >= 0 && vat <= 100 && wht >= 0 && wht <= 100)) throw new UserError('Rates must be between 0 and 100.');
  await c.q.query(`insert into fin_settings (org_id, vat_rate, wht_rate) values ($1,$2,$3) on conflict (org_id) do update set vat_rate = excluded.vat_rate, wht_rate = excluded.wht_rate, updated_at = now()`, [c.orgId, vat, wht]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'finance.tax_settings_changed', entity: 'fin_settings', entityId: c.orgId, after: { vat, wht }, ip: c.ip, userAgent: c.userAgent });
}

async function accounts(q: Q, orgId: string): Promise<AccountIds> {
  return {
    ar: await ensureAccount(q, orgId, '1200', 'Accounts receivable', 'asset'), whtRecv: await ensureAccount(q, orgId, '1210', 'Withholding tax receivable', 'asset'),
    vatIn: await ensureAccount(q, orgId, '1220', 'VAT input (recoverable)', 'asset'), ap: await ensureAccount(q, orgId, '2000', 'Accounts payable', 'liability'),
    vatOut: await ensureAccount(q, orgId, '2200', 'VAT output payable', 'liability'), whtPay: await ensureAccount(q, orgId, '2210', 'WHT payable', 'liability'),
  };
}

async function nextNumber(q: Q, orgId: string, kind: InvoiceKind) {
  await q.query('select pg_advisory_xact_lock(hashtext($1))', [`invno:${orgId}`]);
  const r = await q.query<{ n: number }>(`select coalesce(max(substring(number from '[0-9]+$')::int), 0) + 1 as n from fin_invoices where kind = $1`, [kind]);
  return `${kind === 'receivable' ? 'INV' : 'BILL'}-${String(r[0].n).padStart(5, '0')}`;
}

// ---- Invoices ------------------------------------------------------------------------------------------------------------------------------------
export interface InvoiceInput { kind: InvoiceKind; partyId?: string; crmAccountId?: string; description: string; categoryId: string; issueDate: string; dueDate: string; subtotal: string; vat: boolean }

export async function createInvoice(c: Ctx, i: InvoiceInput) {
  need(c, 'finance:create');
  if (!['receivable', 'payable'].includes(i.kind)) throw new UserError('Unknown invoice type.');
  if (i.description.trim().length < 3) throw new UserError('Describe what the invoice is for.');
  if (!isDate(i.issueDate) || !isDate(i.dueDate) || i.dueDate < i.issueDate) throw new UserError('Enter valid dates; the due date cannot be before the issue date.');
  const subtotal = money(i.subtotal);
  let partyId = i.partyId || null;
  let crm: string | null = null;
  if (i.crmAccountId) {
    const a = (await c.q.query<any>('select id, fin_party_id from crm_accounts where id = $1', [i.crmAccountId]))[0];
    if (!a) throw new UserError('Unknown CRM account.');
    if (!a.fin_party_id) throw new UserError('That CRM account is not yet a paying client. Mark it as a client first.');
    partyId = a.fin_party_id; crm = a.id;
  }
  const party = partyId ? (await c.q.query<any>('select id, kind from fin_parties where id = $1 and active', [partyId]))[0] : null;
  if (!party) throw new UserError(i.kind === 'receivable' ? 'Choose the client.' : 'Choose the vendor.');
  if (party.kind !== (i.kind === 'receivable' ? 'client' : 'vendor')) throw new UserError(i.kind === 'receivable' ? 'Receivables are raised against clients.' : 'Bills are recorded against vendors.');
  const cat = (await c.q.query<any>('select id, type from fin_accounts where id = $1 and active', [i.categoryId]))[0];
  if (!cat || cat.type !== (i.kind === 'receivable' ? 'income' : 'expense')) throw new UserError(i.kind === 'receivable' ? 'Choose an income account.' : 'Choose an expense account.');
  const { vatRate } = await getTaxSettings(c.q);
  const vat = i.vat ? vatOn(subtotal, vatRate) : 0;
  const acc = await accounts(c.q, c.orgId);
  const number = await nextNumber(c.q, c.orgId, i.kind);
  const e = await postEntry(c.q, c.orgId, c.userId, { date: i.issueDate, memo: `${number} ${i.description.trim()}`, sourceType: 'invoice', lines: invoiceLines({ kind: i.kind, categoryId: cat.id, subtotal, vat, acc }) });
  const r = await c.q.query<{ id: string }>(
    `insert into fin_invoices (org_id, kind, number, party_id, crm_account_id, description, category_account_id, issue_date, due_date, subtotal, vat_amount, total, status, entry_id, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
    [c.orgId, i.kind, number, party.id, crm, i.description.trim(), cat.id, i.issueDate, i.dueDate, toDb(subtotal), toDb(vat), toDb(subtotal + vat), i.kind === 'payable' ? 'pending' : 'open', e.id, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'invoice.created', entity: 'fin_invoice', entityId: r[0].id, after: { number, kind: i.kind, total: toDb(subtotal + vat) }, ip: c.ip, userAgent: c.userAgent });
  return { id: r[0].id, number };
}

/** Payables must be approved by someone other than the creator; larger bills need the band's final authority. */
export async function approveInvoice(c: Ctx, id: string) {
  need(c, 'finance:approve');
  const inv = (await c.q.query<any>('select * from fin_invoices where id = $1 for update', [id]))[0];
  if (!inv) throw new UserError('Invoice not found.');
  if (inv.kind !== 'payable' || inv.status !== 'pending') throw new UserError('Only bills awaiting approval can be approved.');
  if (inv.created_by === c.userId) throw new UserError('Separation of duties: you recorded this bill, so someone else must approve it.');
  const band = selectBand(fromDb(inv.total), await listBands(c.q));
  const last = band?.steps[band.steps.length - 1];
  if (last) {
    const roles = (await c.q.query<{ key: string }>(`select r.key from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1 and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date)`, [c.userId])).map((r) => r.key);
    if (!roles.includes(last) && !roles.includes('executive') && !roles.includes('super_admin')) throw new UserError(`A bill of this size must be approved by the ${last.replace(/_/g, ' ')}.`);
  }
  await c.q.query(`update fin_invoices set status = 'open', approved_by = $2, approved_at = now() where id = $1`, [id, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'invoice.approved', entity: 'fin_invoice', entityId: id, before: { status: 'pending' }, after: { status: 'open' }, ip: c.ip, userAgent: c.userAgent });
  await notify(c.q, c.orgId, inv.created_by, 'Your bill was approved', `${inv.number} is ready to pay.`, `/finance/invoices/${id}`);
}

const VIEW = `select i.*, i.issue_date::text as issue_d, i.due_date::text as due_d, p.name as party, a.code as cat_code, a.name as category,
  coalesce((select sum(cash + wht) from fin_invoice_payments x where x.invoice_id = i.id), 0) as settled
  from fin_invoices i join fin_parties p on p.id = i.party_id join fin_accounts a on a.id = i.category_account_id`;
const shape = (r: any) => ({ ...r, totalMinor: fromDb(r.total), subtotalMinor: fromDb(r.subtotal), vatMinor: fromDb(r.vat_amount), settledMinor: fromDb(r.settled), balanceMinor: fromDb(r.total) - fromDb(r.settled), issue: r.issue_d as string, due: r.due_d as string });

export async function listInvoices(c: Ctx, kind: InvoiceKind, status?: string) {
  need(c, 'finance:view');
  const rows = await c.q.query<any>(`${VIEW} where i.kind = $1 ${status ? 'and i.status = $2' : ''} order by i.due_date desc limit 300`, status ? [kind, status] : [kind]);
  return rows.map(shape);
}

export async function getInvoice(c: Ctx, id: string) {
  need(c, 'finance:view');
  const inv = (await c.q.query<any>(`${VIEW} where i.id = $1`, [id]))[0];
  if (!inv) throw new UserError('Invoice not found.');
  const pays = await c.q.query<any>(`select x.*, x.paid_on::text as paid_d, a.name as account, u.email as by from fin_invoice_payments x join fin_accounts a on a.id = x.cash_account_id join users u on u.id = x.created_by where x.invoice_id = $1 order by x.paid_on, x.created_at`, [id]);
  const set = await getTaxSettings(c.q);
  return { inv: shape(inv), payments: pays.map((p) => ({ ...p, cashMinor: fromDb(p.cash), whtMinor: fromDb(p.wht), paid: p.paid_d as string })), suggestedWhtMinor: whtOn(fromDb(inv.subtotal), set.whtRate) };
}

export async function recordInvoicePayment(c: Ctx, id: string, i: { cashAccountId: string; cash: string; wht?: string; reference: string; date?: string }) {
  need(c, 'finance:pay');
  const inv = (await c.q.query<any>('select * from fin_invoices where id = $1 for update', [id]))[0];
  if (!inv) throw new UserError('Invoice not found.');
  if (inv.status !== 'open') throw new UserError(inv.status === 'pending' ? 'This bill must be approved before it can be paid.' : 'This invoice is not open for payment.');
  if (inv.kind === 'payable') {
    if (inv.created_by === c.userId) throw new UserError('Separation of duties: you recorded this bill, so someone else must pay it.');
    if (inv.approved_by === c.userId) throw new UserError('Separation of duties: you approved this bill, so someone else must pay it.');
  }
  if (!i.reference.trim()) throw new UserError('Enter the payment reference (receipt, transfer or cheque number).');
  const cash = moneyOrZero(i.cash), wht = moneyOrZero(i.wht ?? '');
  if (cash + wht <= 0) throw new UserError('Enter the amount received or paid.');
  const settled = fromDb((await c.q.query<any>('select coalesce(sum(cash + wht),0) s from fin_invoice_payments where invoice_id = $1', [id]))[0].s);
  const balance = fromDb(inv.total) - settled;
  if (cash + wht > balance) throw new UserError(`That is more than the balance (${toDb(balance)}).`);
  const acct = (await c.q.query<any>('select id, name, is_cash from fin_accounts where id = $1 and active', [i.cashAccountId]))[0];
  if (!acct?.is_cash) throw new UserError('Choose the cash or bank account.');
  if (inv.kind === 'payable' && cash > 0 && (await cashBalance(c.q, acct.id)) < cash) throw new UserError(`Insufficient funds in ${acct.name}.`);
  const date = i.date && isDate(i.date) ? i.date : today();
  const acc = await accounts(c.q, c.orgId);
  const e = await postEntry(c.q, c.orgId, c.userId, { date, memo: `${inv.number} ${inv.kind === 'receivable' ? 'receipt' : 'payment'}`, sourceType: 'invoice_payment', lines: settlementLines({ kind: inv.kind, cashId: acct.id, cash, wht, acc }) });
  const p = await c.q.query<{ id: string }>(`insert into fin_invoice_payments (org_id, invoice_id, paid_on, cash, wht, cash_account_id, reference, entry_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [c.orgId, id, date, toDb(cash), toDb(wht), acct.id, i.reference.trim(), e.id, c.userId]);
  if (cash + wht === balance) await c.q.query(`update fin_invoices set status = 'paid' where id = $1`, [id]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'invoice.payment_recorded', entity: 'fin_invoice', entityId: id, after: { cash: toDb(cash), wht: toDb(wht), reference: i.reference.trim() }, ip: c.ip, userAgent: c.userAgent });
  return { id: p[0].id, settled: cash + wht === balance };
}

export async function voidInvoice(c: Ctx, id: string, reason: string) {
  need(c, 'finance:reverse');
  const inv = (await c.q.query<any>('select * from fin_invoices where id = $1 for update', [id]))[0];
  if (!inv) throw new UserError('Invoice not found.');
  if (inv.status === 'void') throw new UserError('Already void.');
  if ((await c.q.query('select 1 from fin_invoice_payments where invoice_id = $1', [id]))[0]) throw new UserError('This invoice has payments. Void is only possible before any payment is recorded.');
  if (reason.trim().length < 10) throw new UserError('Explain why this is being voided (at least 10 characters).');
  const lines = (await c.q.query<any>('select account_id, debit, credit from fin_journal_lines where entry_id = $1', [inv.entry_id])).map((l): Line => ({ accountId: l.account_id, debit: fromDb(l.debit), credit: fromDb(l.credit) }));
  await postEntry(c.q, c.orgId, c.userId, { date: today(), memo: `Reversal of ${inv.number}`, sourceType: 'reversal', reversesId: inv.entry_id, lines: reverseLines(lines) });
  await c.q.query(`update fin_invoices set status = 'void', void_reason = $2 where id = $1`, [id, reason.trim()]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'invoice.voided', entity: 'fin_invoice', entityId: id, after: { reason: reason.trim() }, ip: c.ip, userAgent: c.userAgent });
}

/** Ageing of outstanding balances by party and bucket. */
export async function ageing(c: Ctx, kind: InvoiceKind, asOf = today()) {
  need(c, 'finance:view');
  const rows = (await c.q.query<any>(`${VIEW} where i.kind = $1 and i.status = 'open'`, [kind])).map(shape).filter((r) => r.balanceMinor > 0 && r.issue <= asOf);
  const byParty = new Map<string, { party: string; buckets: number[]; total: number }>();
  const totals = AGEING_BUCKETS.map(() => 0);
  for (const r of rows) {
    const b = ageingBucket(r.due, asOf);
    const e = byParty.get(r.party_id) ?? { party: r.party, buckets: AGEING_BUCKETS.map(() => 0), total: 0 };
    e.buckets[b] += r.balanceMinor; e.total += r.balanceMinor; totals[b] += r.balanceMinor;
    byParty.set(r.party_id, e);
  }
  return { asOf, labels: [...AGEING_BUCKETS], rows: [...byParty.values()].sort((a, b) => b.total - a.total), totals, grand: totals.reduce((a, b) => a + b, 0), overdue: rows.filter((r) => ageingBucket(r.due, asOf) > 0) };
}

/** VAT and WHT position from the ledger: output vs input VAT, WHT held for us vs owed to the tax authority. */
export async function taxPosition(c: Ctx) {
  need(c, 'finance:view');
  const bal = async (code: string, normal: 'd' | 'c') => {
    const r = (await c.q.query<any>(`select coalesce(sum(l.debit),0) d, coalesce(sum(l.credit),0) c from fin_journal_lines l join fin_accounts a on a.id = l.account_id where a.code = $1`, [code]))[0];
    return normal === 'd' ? fromDb(r.d) - fromDb(r.c) : fromDb(r.c) - fromDb(r.d);
  };
  const [out, inn, rec, pay] = await Promise.all([bal('2200', 'c'), bal('1220', 'd'), bal('1210', 'd'), bal('2210', 'c')]);
  return { vatOutput: out, vatInput: inn, vatNet: out - inn, whtReceivable: rec, whtPayable: pay };
}

// ---- Bank statement import ----------------------------------------------------------------------------------------------------------------------
export async function importBankStatement(c: Ctx, accountId: string, csv: string) {
  need(c, 'finance:reconcile');
  const acct = (await c.q.query<any>('select id, is_cash from fin_accounts where id = $1', [accountId]))[0];
  if (!acct?.is_cash) throw new UserError('Choose a bank or cash account.');
  if (csv.length > 1_000_000) throw new UserError('That file is too large (limit 1 MB).');
  const { lines, errors } = parseBankCsv(csv);
  if (!lines.length) throw new UserError(errors[0] ?? 'No transactions found in the file.');
  if (lines.length > 2000) throw new UserError('Import at most 2,000 lines at a time.');
  const batch = `${today()}-${Math.random().toString(36).slice(2, 7)}`;
  let added = 0;
  for (const l of lines) {
    const r = await c.q.query(`insert into fin_bank_lines (org_id, account_id, batch, line_date, description, reference, amount, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing returning id`,
      [c.orgId, accountId, batch, l.date, l.description, l.reference, toDb(l.amount), c.userId]);
    if (r[0]) added++;
  }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'bank.imported', entity: 'fin_account', entityId: accountId, after: { batch, added, skippedDuplicates: lines.length - added }, ip: c.ip, userAgent: c.userAgent });
  return { added, duplicates: lines.length - added, errors };
}

async function candidates(q: Q, accountId: string): Promise<(Candidate & { label: string })[]> {
  const t = await q.query<any>(`select t.id, t.number, t.title, t.kind, t.amount, t.status, coalesce(t.paid_at, t.created_at)::date::text as d, coalesce(t.payment_ref, t.number) as ref, t.cash_account_id, t.category_account_id
    from fin_transactions t where t.status in ('paid','posted') and (t.cash_account_id = $1 or (t.kind = 'transfer' and t.category_account_id = $1))
      and not exists (select 1 from fin_bank_lines b where b.txn_id = t.id)`, [accountId]);
  const out: (Candidate & { label: string })[] = t.map((x) => {
    const outflow = x.kind === 'expense' || (x.kind === 'transfer' && x.cash_account_id === accountId);
    return { id: x.id, kind: 'txn' as const, date: x.d, amount: (outflow ? -1 : 1) * fromDb(x.amount), ref: x.ref, label: `${x.number} ${x.title}` };
  });
  const p = await q.query<any>(`select x.id, x.cash, x.paid_on::text as d, x.reference, i.number, i.kind from fin_invoice_payments x join fin_invoices i on i.id = x.invoice_id
    where x.cash_account_id = $1 and x.cash > 0 and not exists (select 1 from fin_bank_lines b where b.payment_id = x.id)`, [accountId]);
  for (const x of p) out.push({ id: x.id, kind: 'payment', date: x.d, amount: (x.kind === 'receivable' ? 1 : -1) * fromDb(x.cash), ref: x.reference, label: `${x.number} ${x.kind === 'receivable' ? 'receipt' : 'payment'}` });
  return out;
}

export async function bankWorkbench(c: Ctx, accountId: string) {
  need(c, 'finance:reconcile');
  const lines = await c.q.query<any>(`select id, line_date::text as d, description, reference, amount, status, txn_id, payment_id from fin_bank_lines where account_id = $1 order by line_date desc, created_at desc limit 300`, [accountId]);
  const cands = await candidates(c.q, accountId);
  return lines.map((l) => {
    const line = { date: l.d, description: l.description ?? '', reference: l.reference ?? '', amount: fromDb(l.amount) };
    const m = l.status === 'unmatched' ? suggestMatch(line, cands) : null;
    return { id: l.id, ...line, status: l.status as string, suggestion: m ? { id: m.id, kind: m.kind, label: (cands.find((x) => x.id === m.id) as any).label as string } : null };
  });
}

export async function matchBankLine(c: Ctx, lineId: string, target: { kind: 'txn' | 'payment'; id: string }) {
  need(c, 'finance:reconcile');
  const l = (await c.q.query<any>(`select * from fin_bank_lines where id = $1 for update`, [lineId]))[0];
  if (!l || l.status !== 'unmatched') throw new UserError('That statement line is already handled.');
  const cand = (await candidates(c.q, l.account_id)).find((x) => x.id === target.id && x.kind === target.kind);
  if (!cand) throw new UserError('That record is not available to match on this account.');
  if (cand.amount !== fromDb(l.amount)) throw new UserError('The amounts do not match. Match only identical amounts.');
  if (target.kind === 'txn') await reconcileTransaction(c, target.id, `Bank line ${l.line_date instanceof Date ? l.line_date.toISOString().slice(0, 10) : String(l.line_date).slice(0, 10)} ${l.reference ?? ''}`.trim());
  await c.q.query(`update fin_bank_lines set status = 'matched', txn_id = $2, payment_id = $3 where id = $1`, [lineId, target.kind === 'txn' ? target.id : null, target.kind === 'payment' ? target.id : null]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'bank.line_matched', entity: 'fin_bank_line', entityId: lineId, after: target, ip: c.ip, userAgent: c.userAgent });
}

export async function ignoreBankLine(c: Ctx, lineId: string) {
  need(c, 'finance:reconcile');
  const r = await c.q.query(`update fin_bank_lines set status = 'ignored' where id = $1 and status = 'unmatched' returning id`, [lineId]);
  if (!r[0]) throw new UserError('That statement line is already handled.');
}

export const canApproveInvoices = (c: Ctx) => can(c.subject, 'finance:approve').allow;
