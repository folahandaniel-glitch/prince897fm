import { fromDb, MoneyError, parseMoney, toDb } from '../domain/finance';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import { cashBalance, ensureAccount, postEntry } from './finance';
import { notify } from './hr';

/**
 * Salary advances. Request (staff) -> approve (HR, CEO or Finance, never the same person) -> pay (finance, a third person) ->
 * recovered automatically through payroll over 1 to 6 months. The cash that leaves is held in "Staff deductions payable" until payroll
 * deducts it again, so the ledger nets to zero when the advance is fully recovered.
 */
const money = (s: string) => { try { return parseMoney(s); } catch (e) { if (e instanceof MoneyError) throw new UserError(e.message); throw e; } };

/** The most a person can borrow: one month's fixed pay (basic + housing + transport) from their current compensation. */
export async function advanceLimit(c: Ctx, employeeId: string): Promise<number | null> {
  const r = (await c.q.query<any>('select basic, housing, transport from comp_profiles where employee_id = $1 and effective_to is null', [employeeId]))[0];
  return r ? fromDb(r.basic) + fromDb(r.housing) + fromDb(r.transport) : null;
}

export async function requestAdvance(c: Ctx, i: { amount: string; months: number; reason: string }) {
  need(c, 'advance:request');
  if (!c.subject.employeeId) throw new UserError('Your login is not linked to an employee record. Ask HR to link it.');
  const amount = money(i.amount);
  if (!(Number.isInteger(i.months) && i.months >= 1 && i.months <= 6)) throw new UserError('Choose a repayment period of 1 to 6 months.');
  if (i.reason.trim().length < 5) throw new UserError('Say briefly why you need the advance.');
  const limit = await advanceLimit(c, c.subject.employeeId);
  if (limit == null) throw new UserError('There is no salary on file for you yet, so an advance cannot be offered. Ask HR.');
  if (amount > limit) throw new UserError(`The most you can request is ${toDb(limit)} (one month's pay).`);
  if ((await c.q.query(`select 1 from salary_advances where employee_id = $1 and status in ('requested','approved','paid')`, [c.subject.employeeId]))[0]) throw new UserError('You already have an advance that is open. Settle it before asking for another.');
  const r = await c.q.query<{ id: string }>('insert into salary_advances (org_id, employee_id, amount, reason, months) values ($1,$2,$3,$4,$5) returning id', [c.orgId, c.subject.employeeId, toDb(amount), i.reason.trim(), i.months]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'advance.requested', entity: 'salary_advance', entityId: r[0].id, after: { amount: toDb(amount), months: i.months }, ip: c.ip, userAgent: c.userAgent });
  const approvers = await c.q.query<{ user_id: string }>(`select distinct ur.user_id from user_roles ur join roles r on r.id = ur.role_id where r.permissions && array['advance:approve'] and r.key <> 'super_admin' limit 10`);
  for (const a of approvers) if (a.user_id !== c.userId) await notify(c.q, c.orgId, a.user_id, 'Salary advance awaiting approval', `${toDb(amount)} over ${i.months} month(s)`, '/advances');
  return r[0].id;
}

export async function listAdvances(c: Ctx, scope: 'mine' | 'all') {
  const all = scope === 'all';
  if (all) { if (!c.subject.grants.some((g) => g.permissions.some((p) => ['advance:approve', 'advance:pay', '*'].includes(p)))) need(c, 'advance:approve'); }
  else need(c, 'advance:request');
  const rows = await c.q.query<any>(`select s.*, e.full_name, e.user_id,
      (select coalesce(sum(amount),0) from pay_adjustments x where x.source_type = 'manual' and x.source_ref like 'advance:' || s.id::text || ':%' and x.status = 'applied') as repaid,
      (select count(*)::int from pay_adjustments x where x.source_type = 'manual' and x.source_ref like 'advance:' || s.id::text || ':%' and x.status = 'applied') as repaid_n
    from salary_advances s join employees e on e.id = s.employee_id ${all ? '' : 'where s.employee_id = $1'} order by s.requested_at desc limit 200`, all ? [] : [c.subject.employeeId]);
  const out = [];
  for (const r of rows) {
    if (r.status === 'paid' && r.repaid_n >= r.months) { await c.q.query(`update salary_advances set status = 'settled' where id = $1`, [r.id]); r.status = 'settled'; }
    out.push({ ...r, amountMinor: fromDb(r.amount), repaidMinor: fromDb(r.repaid) });
  }
  return out;
}

async function load(c: Ctx, id: string) {
  const a = (await c.q.query<any>('select s.*, e.user_id from salary_advances s join employees e on e.id = s.employee_id where s.id = $1 for update of s', [id]))[0];
  if (!a) throw new UserError('Advance not found.');
  return a;
}

export async function decideAdvance(c: Ctx, id: string, approve: boolean, note: string) {
  need(c, 'advance:approve');
  const a = await load(c, id);
  if (a.status !== 'requested') throw new UserError('This request has already been decided.');
  if (a.employee_id === c.subject.employeeId) throw new UserError('Separation of duties: you cannot decide your own advance.');
  if (!approve && note.trim().length < 3) throw new UserError('Give a short reason for declining.');
  await c.q.query(`update salary_advances set status = $2, decided_by = $3, decided_at = now(), decision_note = $4 where id = $1`, [id, approve ? 'approved' : 'rejected', c.userId, note.trim() || null]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: approve ? 'advance.approved' : 'advance.rejected', entity: 'salary_advance', entityId: id, reason: note.trim() || null, ip: c.ip, userAgent: c.userAgent });
  if (a.user_id) await notify(c.q, c.orgId, a.user_id, approve ? 'Your salary advance was approved' : 'Your salary advance was declined', note.trim() || undefined, '/advances');
}

/** Records the payment and schedules the monthly recoveries through payroll. */
export async function payAdvance(c: Ctx, id: string, i: { cashAccountId: string; reference: string }) {
  need(c, 'advance:pay');
  const a = await load(c, id);
  if (a.status !== 'approved') throw new UserError('Only approved advances can be paid.');
  if ([a.decided_by, a.employee_id === c.subject.employeeId ? c.userId : null].includes(c.userId)) throw new UserError('Separation of duties: the person who approved it (or the borrower) cannot pay it.');
  if (!i.reference.trim()) throw new UserError('Enter the payment reference.');
  const acct = (await c.q.query<any>('select id, name, is_cash from fin_accounts where id = $1 and active', [i.cashAccountId]))[0];
  if (!acct?.is_cash) throw new UserError('Choose the cash or bank account the money is paid from.');
  const amount = fromDb(a.amount);
  if ((await cashBalance(c.q, acct.id)) < amount) throw new UserError(`Insufficient funds in ${acct.name}.`);
  const clearing = await ensureAccount(c.q, c.orgId, '2140', 'Staff deductions payable', 'liability');
  await postEntry(c.q, c.orgId, c.userId, { date: new Date().toISOString().slice(0, 10), memo: `Salary advance ${id.slice(0, 8)}`, sourceType: 'manual', lines: [{ accountId: clearing, debit: amount, credit: 0 }, { accountId: acct.id, debit: 0, credit: amount }] });
  await c.q.query(`update salary_advances set status = 'paid', paid_by = $2, paid_at = now(), payment_ref = $3 where id = $1`, [id, c.userId, i.reference.trim()]);
  // Equal monthly recoveries starting next month; the last one carries any rounding.
  const now = new Date(); const per = Math.floor(amount / a.months);
  for (let n = 1; n <= a.months; n++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + n, 1));
    const part = n === a.months ? amount - per * (a.months - 1) : per;
    await c.q.query(`insert into pay_adjustments (org_id, employee_id, period, kind, amount, reason, source_type, source_ref, status, proposed_by, decided_by, decided_at) values ($1,$2,$3,'loan_repayment',$4,$5,'manual',$6,'approved',$7,$7,now())`,
      [c.orgId, a.employee_id, d.toISOString().slice(0, 7), toDb(part), `Salary advance repayment ${n}/${a.months}`, `advance:${id}:${n}`, c.userId]);
  }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'advance.paid', entity: 'salary_advance', entityId: id, after: { amount: toDb(amount), reference: i.reference.trim(), months: a.months }, ip: c.ip, userAgent: c.userAgent });
  if (a.user_id) await notify(c.q, c.orgId, a.user_id, 'Your salary advance has been paid', `Repayment starts next month over ${a.months} month(s).`, '/advances');
}

export async function cancelAdvance(c: Ctx, id: string) {
  need(c, 'advance:request');
  const a = await load(c, id);
  if (a.employee_id !== c.subject.employeeId) throw new UserError('You can only cancel your own request.');
  if (!['requested', 'approved'].includes(a.status)) throw new UserError('It can no longer be cancelled.');
  await c.q.query(`update salary_advances set status = 'cancelled' where id = $1`, [id]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'advance.cancelled', entity: 'salary_advance', entityId: id, ip: c.ip, userAgent: c.userAgent });
}
