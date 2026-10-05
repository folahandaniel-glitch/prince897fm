/**
 * Pure finance rules. Money is handled as integer minor units (kobo/cents) in code and numeric(18,2) in the database,
 * never floating point. Management accounting only: not a certified statutory accounting or tax package.
 */

export class MoneyError extends Error {}

/** Parse a user-entered amount ("1,234.50") into minor units. Rejects zero, negatives, >2 decimals and absurd sizes. */
export function parseMoney(input: string): number {
  const s = input.trim().replace(/,/g, '').replace(/^₦/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new MoneyError('Enter an amount like 25000 or 25,000.50 (at most 2 decimals).');
  const [whole, frac = ''] = s.split('.');
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!(minor > 0)) throw new MoneyError('The amount must be greater than zero.');
  if (minor > 1e13) throw new MoneyError('That amount is too large.');
  return minor;
}

/** numeric(18,2) text from the database -> minor units. */
export function fromDb(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const [w, f = ''] = String(v).split('.');
  const neg = w.startsWith('-');
  const n = Math.abs(Number(w)) * 100 + Number(f.padEnd(2, '0').slice(0, 2));
  return neg ? -n : n;
}
export const toDb = (minor: number): string => `${minor < 0 ? '-' : ''}${Math.floor(Math.abs(minor) / 100)}.${String(Math.abs(minor) % 100).padStart(2, '0')}`;

export function formatMoney(minor: number, currency = 'NGN', locale = 'en-NG'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2 }).format(minor / 100);
}

// ---- Approval bands --------------------------------------------------------------------------------------------------
export interface Band { minAmount: number; steps: string[] } // minAmount in minor units

/** The band with the highest threshold that the amount reaches. Lower amounts need fewer approvers. */
export function selectBand(amount: number, bands: Band[]): Band | null {
  const eligible = bands.filter((b) => b.minAmount <= amount).sort((a, b) => b.minAmount - a.minAmount);
  return eligible[0] ?? null;
}

// ---- Separation of duties --------------------------------------------------------------------------------------------
export interface Trail { creator: string; reviewer?: string | null; approvers: string[]; payer?: string | null }
export type SodAction = 'review' | 'approve' | 'pay' | 'reconcile';

/** Returns a plain-language reason when the actor may not perform this step on this record, else null. */
export function sodViolation(actor: string, action: SodAction, t: Trail): string | null {
  if (action === 'review' && actor === t.creator) return 'You created this transaction, so someone else must review it.';
  if (action === 'approve') {
    if (actor === t.creator) return 'You created this transaction, so someone else must approve it.';
    if (actor === t.reviewer) return 'You reviewed this transaction, so someone else must approve it.';
    if (t.approvers.includes(actor)) return 'You already approved an earlier stage of this transaction.';
  }
  if (action === 'pay') {
    if (actor === t.creator) return 'You created this transaction, so someone else must make the payment.';
    if (actor === t.reviewer) return 'You reviewed this transaction, so someone else must make the payment.';
    if (t.approvers.includes(actor)) return 'You approved this transaction, so someone else must make the payment.';
  }
  if (action === 'reconcile' && (actor === t.payer || actor === t.creator)) return 'You recorded this transaction or its payment, so someone else must reconcile it.';
  return null;
}

// ---- Posting rules ---------------------------------------------------------------------------------------------------------
export interface Line { accountId: string; debit: number; credit: number; departmentId?: string | null; branchId?: string | null }

export function accrualLines(i: { categoryId: string; apId: string; amount: number; departmentId?: string | null; branchId?: string | null }): Line[] {
  return [{ accountId: i.categoryId, debit: i.amount, credit: 0, departmentId: i.departmentId, branchId: i.branchId }, { accountId: i.apId, debit: 0, credit: i.amount, departmentId: i.departmentId, branchId: i.branchId }];
}
export function paymentLines(i: { apId: string; cashId: string; amount: number; departmentId?: string | null; branchId?: string | null }): Line[] {
  return [{ accountId: i.apId, debit: i.amount, credit: 0, departmentId: i.departmentId, branchId: i.branchId }, { accountId: i.cashId, debit: 0, credit: i.amount, departmentId: i.departmentId, branchId: i.branchId }];
}
export function receiptLines(i: { cashId: string; incomeId: string; amount: number; departmentId?: string | null; branchId?: string | null }): Line[] {
  return [{ accountId: i.cashId, debit: i.amount, credit: 0, departmentId: i.departmentId, branchId: i.branchId }, { accountId: i.incomeId, debit: 0, credit: i.amount, departmentId: i.departmentId, branchId: i.branchId }];
}
export function transferLines(i: { fromId: string; toId: string; amount: number }): Line[] {
  return [{ accountId: i.toId, debit: i.amount, credit: 0 }, { accountId: i.fromId, debit: 0, credit: i.amount }];
}
/** A reversal is the mirror image: the original is never edited or deleted. */
export const reverseLines = (lines: Line[]): Line[] => lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));

export function isBalanced(lines: Line[]): boolean {
  return lines.length >= 2 && lines.reduce((s, l) => s + l.debit - l.credit, 0) === 0 && lines.every((l) => (l.debit > 0) !== (l.credit > 0));
}

// ---- Budgets and balances ----------------------------------------------------------------------------------------------------
export function budgetStatus(spent: number, budget: number): { pct: number; level: 'ok' | 'warning' | 'over' } {
  if (budget <= 0) return { pct: spent > 0 ? 100 : 0, level: spent > 0 ? 'over' : 'ok' };
  const pct = Math.round((spent / budget) * 100);
  return { pct, level: pct >= 100 ? 'over' : pct >= 80 ? 'warning' : 'ok' };
}

/** Natural balance of an account: assets and expenses grow with debits; the rest with credits. */
export const naturalBalance = (type: string, debit: number, credit: number) => (type === 'asset' || type === 'expense' ? debit - credit : credit - debit);

export const STATUS_FLOW = {
  expense: ['draft', 'submitted', 'reviewed', 'approved', 'paid', 'reconciled'],
  transfer: ['draft', 'submitted', 'reviewed', 'approved', 'paid', 'reconciled'],
  income: ['draft', 'submitted', 'posted', 'reconciled'],
} as const;
