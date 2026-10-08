import { vatOn } from '../domain/invoices';
import { fromDb, MoneyError, parseMoney, toDb } from '../domain/finance';
import { can } from '../domain/policy';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import { createInvoice, getTaxSettings } from './invoices';

/** Proposals and estimates for clients. They carry line items and VAT, can be printed, and an accepted one converts into an invoice. */
export interface QuoteLine { description: string; qty: number; unit: string }
const KIND_PREFIX = { proposal: 'PRO', estimate: 'EST' } as const;
const money = (s: string) => { try { return parseMoney(s); } catch (e) { if (e instanceof MoneyError) throw new UserError(e.message); throw e; } };

export function totals(lines: { qty: number; unitMinor: number }[], vatRate: number, withVat: boolean) {
  const subtotal = lines.reduce((a, l) => a + Math.round(l.qty * l.unitMinor), 0);
  const vat = withVat ? vatOn(subtotal, vatRate) : 0;
  return { subtotal, vat, total: subtotal + vat };
}

export async function createQuote(c: Ctx, i: { kind: string; partyId: string; title: string; lines: QuoteLine[]; notes?: string; vat?: boolean; validUntil: string }) {
  need(c, 'quote:manage');
  if (!(i.kind in KIND_PREFIX)) throw new UserError('Choose proposal or estimate.');
  if (i.title.trim().length < 2) throw new UserError('Give it a title.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.validUntil) || i.validUntil < new Date().toISOString().slice(0, 10)) throw new UserError('Choose a valid-until date that is not in the past.');
  const party = (await c.q.query<any>(`select id from fin_parties where id = $1 and kind = 'client' and active`, [i.partyId]))[0];
  if (!party) throw new UserError('Choose a client.');
  const lines = i.lines.filter((l) => l.description.trim() || l.unit.trim());
  if (lines.length === 0) throw new UserError('Add at least one line.');
  if (lines.length > 50) throw new UserError('At most 50 lines.');
  const parsed = lines.map((l) => {
    if (l.description.trim().length < 2) throw new UserError('Every line needs a description.');
    if (!(l.qty > 0 && l.qty <= 100000)) throw new UserError('Quantities must be greater than zero.');
    return { description: l.description.trim().slice(0, 300), qty: Math.round(l.qty * 100) / 100, unitMinor: money(l.unit) };
  });
  const { vatRate } = await getTaxSettings(c.q);
  const t = totals(parsed, vatRate, !!i.vat);
  await c.q.query('select pg_advisory_xact_lock(hashtext($1))', [`quote:${c.orgId}`]);
  const prefix = KIND_PREFIX[i.kind as keyof typeof KIND_PREFIX];
  const n = (await c.q.query<{ n: number }>(`select coalesce(max(substring(number from '[0-9]+$')::int), 0) + 1 as n from fin_quotes where kind = $1`, [i.kind]))[0].n;
  const number = `${prefix}-${String(n).padStart(5, '0')}`;
  const r = await c.q.query<{ id: string }>(`insert into fin_quotes (org_id, kind, number, party_id, title, lines, notes, vat, subtotal, vat_amount, total, valid_until, created_by) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13) returning id`,
    [c.orgId, i.kind, number, party.id, i.title.trim(), JSON.stringify(parsed.map((l) => ({ description: l.description, qty: l.qty, unit: toDb(l.unitMinor) }))), i.notes?.trim() || null, !!i.vat, toDb(t.subtotal), toDb(t.vat), toDb(t.total), i.validUntil, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'quote.created', entity: 'fin_quote', entityId: r[0].id, after: { number, total: toDb(t.total) }, ip: c.ip, userAgent: c.userAgent });
  return { id: r[0].id, number };
}

const canSee = (c: Ctx) => can(c.subject, 'quote:view').allow;
export async function listQuotes(c: Ctx, kind?: string) {
  if (!canSee(c)) need(c, 'quote:view');
  const rows = await c.q.query<any>(`select q.id, q.kind, q.number, q.title, q.status, q.total, q.valid_until::text as valid_until, p.name as client, (q.status in ('draft','sent') and q.valid_until < current_date) as lapsed from fin_quotes q join fin_parties p on p.id = q.party_id ${kind ? 'where q.kind = $1' : ''} order by q.created_at desc limit 200`, kind ? [kind] : []);
  return rows.map((r) => ({ ...r, totalMinor: fromDb(r.total) }));
}
export async function getQuote(c: Ctx, id: string) {
  if (!canSee(c)) need(c, 'quote:view');
  const q = (await c.q.query<any>(`select q.*, q.valid_until::text as valid_s, p.name as client, p.email as client_email, i.number as invoice_no from fin_quotes q join fin_parties p on p.id = q.party_id left join fin_invoices i on i.id = q.invoice_id where q.id = $1`, [id]))[0];
  return q ? { ...q, subtotalMinor: fromDb(q.subtotal), vatMinor: fromDb(q.vat_amount), totalMinor: fromDb(q.total) } : null;
}

export async function setQuoteStatus(c: Ctx, id: string, status: 'sent' | 'accepted' | 'declined') {
  need(c, 'quote:manage');
  const q = (await c.q.query<any>('select status from fin_quotes where id = $1 for update', [id]))[0];
  if (!q) throw new UserError('Not found.');
  const allowed: Record<string, string[]> = { sent: ['draft'], accepted: ['draft', 'sent'], declined: ['draft', 'sent'] };
  if (!allowed[status].includes(q.status)) throw new UserError(`A ${q.status} document cannot be marked ${status}.`);
  await c.q.query('update fin_quotes set status = $2 where id = $1', [id, status]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: `quote.${status}`, entity: 'fin_quote', entityId: id, ip: c.ip, userAgent: c.userAgent });
}

/** Turns an accepted proposal or estimate into a receivable invoice (needs finance entry rights too). */
export async function convertToInvoice(c: Ctx, id: string, i: { categoryId: string; dueDate: string }) {
  need(c, 'quote:manage');
  const q = (await c.q.query<any>('select * from fin_quotes where id = $1 for update', [id]))[0];
  if (!q) throw new UserError('Not found.');
  if (q.status !== 'accepted') throw new UserError('Mark it as accepted by the client first.');
  const inv = await createInvoice(c, { kind: 'receivable', partyId: q.party_id, description: `${q.number}: ${q.title}`.slice(0, 300), categoryId: i.categoryId, issueDate: new Date().toISOString().slice(0, 10), dueDate: i.dueDate, subtotal: q.subtotal, vat: q.vat });
  await c.q.query(`update fin_quotes set status = 'converted', invoice_id = $2 where id = $1`, [id, inv.id]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'quote.converted', entity: 'fin_quote', entityId: id, after: { invoice: inv.number }, ip: c.ip, userAgent: c.userAgent });
  return inv;
}
