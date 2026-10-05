/**
 * Pure rules for invoices (receivables / payables), tax, ageing and bank-statement import. Amounts are integer minor units (kobo).
 * VAT/WHT rates are data (fin_settings) and must be confirmed by an accountant: nothing here asserts a legal rate.
 */
import type { Line } from './finance';

export type InvoiceKind = 'receivable' | 'payable';

/** VAT on a subtotal at a percentage with up to 2 decimals (e.g. 7.5). Rounds half up, integer maths only. */
export function vatOn(subtotal: number, ratePct: number): number {
  if (!(ratePct >= 0 && ratePct <= 100)) throw new Error('Rate must be between 0 and 100.');
  return Math.round((subtotal * Math.round(ratePct * 100)) / 10000);
}
export const whtOn = vatOn;

export interface AccountIds { ar: string; ap: string; vatOut: string; vatIn: string; whtRecv: string; whtPay: string }

/** Journal for raising an invoice. Receivable: Dr AR, Cr income + output VAT. Payable: Dr expense + input VAT, Cr AP. */
export function invoiceLines(i: { kind: InvoiceKind; categoryId: string; subtotal: number; vat: number; acc: AccountIds }): Line[] {
  const total = i.subtotal + i.vat;
  if (i.kind === 'receivable') {
    const l: Line[] = [{ accountId: i.acc.ar, debit: total, credit: 0 }, { accountId: i.categoryId, debit: 0, credit: i.subtotal }];
    if (i.vat > 0) l.push({ accountId: i.acc.vatOut, debit: 0, credit: i.vat });
    return l;
  }
  const l: Line[] = [{ accountId: i.categoryId, debit: i.subtotal, credit: 0 }];
  if (i.vat > 0) l.push({ accountId: i.acc.vatIn, debit: i.vat, credit: 0 });
  l.push({ accountId: i.acc.ap, debit: 0, credit: total });
  return l;
}

/**
 * Journal for a settlement. `cash` moves through the bank; `wht` is tax withheld (by the client for receivables: a credit we hold;
 * by us for payables: a liability to remit). Together they clear `cash + wht` of the invoice balance.
 */
export function settlementLines(i: { kind: InvoiceKind; cashId: string; cash: number; wht: number; acc: AccountIds }): Line[] {
  const l: Line[] = [];
  if (i.kind === 'receivable') {
    if (i.cash > 0) l.push({ accountId: i.cashId, debit: i.cash, credit: 0 });
    if (i.wht > 0) l.push({ accountId: i.acc.whtRecv, debit: i.wht, credit: 0 });
    l.push({ accountId: i.acc.ar, debit: 0, credit: i.cash + i.wht });
  } else {
    l.push({ accountId: i.acc.ap, debit: i.cash + i.wht, credit: 0 });
    if (i.cash > 0) l.push({ accountId: i.cashId, debit: 0, credit: i.cash });
    if (i.wht > 0) l.push({ accountId: i.acc.whtPay, debit: 0, credit: i.wht });
  }
  return l;
}

export const AGEING_BUCKETS = ['Not yet due', '1-30 days', '31-60 days', '61-90 days', 'Over 90 days'] as const;
const dayNum = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

export function ageingBucket(dueDate: string, asOf: string): number {
  const late = dayNum(asOf) - dayNum(dueDate);
  if (late <= 0) return 0;
  if (late <= 30) return 1;
  if (late <= 60) return 2;
  if (late <= 90) return 3;
  return 4;
}

// ---- Bank statement CSV --------------------------------------------------------------------------------------------------------------------------
export interface BankLine { date: string; description: string; reference: string; amount: number } // amount: + in, - out

/** Splits one CSV line honouring quotes. */
export function splitCsv(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function toIso(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return valid(m[1], m[2], m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t); // day first (Nigerian banks)
  if (m) return valid(m[3], m[2], m[1]);
  return null;
}
function valid(y: string, mo: string, d: string): string | null {
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === iso ? iso : null;
}
function minor(s: string): number | null {
  const t = s.replace(/[,\s₦]|NGN/gi, '');
  if (t === '' || t === '-') return 0;
  const neg = /^\(.*\)$/.test(t) || t.startsWith('-');
  const core = t.replace(/[()-]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(core)) return null;
  const [w, f = ''] = core.split('.');
  const v = Number(w) * 100 + Number((f + '00').slice(0, 2));
  return neg ? -v : v;
}

/**
 * Parses a bank statement CSV. Needs a header row naming a date column and either amount, or debit and credit.
 * Optional: description/narration/details, reference/ref.
 */
export function parseBankCsv(text: string): { lines: BankLine[]; errors: string[] } {
  const rows = text.replace(/^﻿/, '').split(/\r?\n/).filter((r) => r.trim());
  const errors: string[] = [];
  if (rows.length < 2) return { lines: [], errors: ['The file needs a header row and at least one transaction.'] };
  const head = splitCsv(rows[0]).map((h) => h.toLowerCase());
  const find = (...names: string[]) => head.findIndex((h) => names.some((n) => h.includes(n)));
  const iDate = find('date'), iDesc = find('description', 'narration', 'details', 'particulars'), iRef = find('reference', 'ref');
  const iAmt = head.findIndex((h) => h === 'amount' || h.startsWith('amount')), iDr = find('debit', 'withdraw'), iCr = find('credit', 'deposit');
  if (iDate < 0 || (iAmt < 0 && (iDr < 0 || iCr < 0))) return { lines: [], errors: ['Could not find the columns. Use headers such as: Date, Description, Reference, and either Amount or Debit and Credit.'] };
  const lines: BankLine[] = [];
  rows.slice(1).forEach((r, k) => {
    const c = splitCsv(r); const n = k + 2;
    const date = toIso(c[iDate] ?? '');
    if (!date) { errors.push(`Row ${n}: unreadable date "${c[iDate] ?? ''}".`); return; }
    let amount: number | null;
    if (iAmt >= 0) amount = minor(c[iAmt] ?? '');
    else { const dr = minor(c[iDr] ?? ''), cr = minor(c[iCr] ?? ''); amount = dr === null || cr === null ? null : Math.abs(cr) - Math.abs(dr); }
    if (amount === null) { errors.push(`Row ${n}: unreadable amount.`); return; }
    if (amount === 0) { errors.push(`Row ${n}: amount is zero, skipped.`); return; }
    lines.push({ date, description: (iDesc >= 0 ? c[iDesc] : '').slice(0, 200), reference: (iRef >= 0 ? c[iRef] : '').slice(0, 100), amount });
  });
  return { lines, errors };
}

export interface Candidate { id: string; date: string; amount: number; ref: string; kind: 'txn' | 'payment' } // amount: + in, - out

/** Suggests the best candidate for a statement line: same signed amount, nearest date within 7 days, reference match preferred. */
export function suggestMatch(line: BankLine, cands: Candidate[]): Candidate | null {
  const near = cands.filter((c) => c.amount === line.amount && Math.abs(dayNum(c.date) - dayNum(line.date)) <= 7);
  if (!near.length) return null;
  const refHit = (c: Candidate) => c.ref && (line.reference + ' ' + line.description).toLowerCase().includes(c.ref.toLowerCase()) ? 0 : 1;
  return near.sort((a, b) => refHit(a) - refHit(b) || Math.abs(dayNum(a.date) - dayNum(line.date)) - Math.abs(dayNum(b.date) - dayNum(line.date)))[0];
}
