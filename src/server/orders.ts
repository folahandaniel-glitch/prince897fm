import { fromDb, MoneyError, parseMoney, toDb } from '../domain/finance';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import type { Q } from './db';
import { notify } from './hr';
import { createInvoice } from './invoices';

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const money = (s: string) => { try { return parseMoney(s); } catch (e) { if (e instanceof MoneyError) throw new UserError(e.message); throw e; } };

export const PO_LABEL: Record<string, string> = { draft: 'Awaiting approval', approved: 'Approved: goods/services awaited', received: 'Received: ready to bill', billed: 'Billed', cancelled: 'Cancelled' };

async function nextNumber(q: Q, orgId: string) {
  await q.query('select pg_advisory_xact_lock(hashtext($1))', [`pono:${orgId}`]);
  const r = await q.query<{ n: number }>(`select coalesce(max(substring(number from '[0-9]+$')::int), 0) + 1 as n from fin_purchase_orders`);
  return `PO-${String(r[0].n).padStart(5, '0')}`;
}

/** Purchase orders: raise -> approve (someone else) -> confirm receipt (someone who did not raise or approve it) -> convert to a vendor bill. */
export async function createOrder(c: Ctx, i: { vendorId: string; description: string; subtotal: string; expectedOn?: string; departmentId?: string }) {
  need(c, 'finance:create');
  if (i.description.trim().length < 3) throw new UserError('Describe what is being ordered.');
  if (i.expectedOn && !isDate(i.expectedOn)) throw new UserError('Enter a valid expected date.');
  const v = (await c.q.query<any>(`select id from fin_parties where id = $1 and kind = 'vendor' and active`, [i.vendorId]))[0];
  if (!v) throw new UserError('Choose a vendor.');
  if (i.departmentId && !(await c.q.query('select 1 from departments where id = $1', [i.departmentId]))[0]) throw new UserError('Unknown department.');
  const number = await nextNumber(c.q, c.orgId);
  const r = await c.q.query<{ id: string }>(`insert into fin_purchase_orders (org_id, number, vendor_id, description, subtotal, expected_on, department_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [c.orgId, number, v.id, i.description.trim(), toDb(money(i.subtotal)), i.expectedOn || null, i.departmentId || null, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'po.created', entity: 'purchase_order', entityId: r[0].id, after: { number }, ip: c.ip, userAgent: c.userAgent });
  return { id: r[0].id, number };
}

async function load(c: Ctx, id: string) {
  const o = (await c.q.query<any>('select * from fin_purchase_orders where id = $1 for update', [id]))[0];
  if (!o) throw new UserError('Purchase order not found.');
  return o;
}

export async function approveOrder(c: Ctx, id: string) {
  need(c, 'finance:approve');
  const o = await load(c, id);
  if (o.status !== 'draft') throw new UserError('Only orders awaiting approval can be approved.');
  if (o.created_by === c.userId) throw new UserError('Separation of duties: you raised this order, so someone else must approve it.');
  await c.q.query(`update fin_purchase_orders set status = 'approved', approved_by = $2, approved_at = now() where id = $1`, [id, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'po.approved', entity: 'purchase_order', entityId: id, ip: c.ip, userAgent: c.userAgent });
  await notify(c.q, c.orgId, o.created_by, 'Purchase order approved', `${o.number} can now be sent to the vendor.`, `/finance/orders/${id}`);
}

/** Anyone with finance access who did not raise or approve the order confirms the goods or services arrived. */
export async function receiveOrder(c: Ctx, id: string, note: string) {
  need(c, 'finance:view');
  const o = await load(c, id);
  if (o.status !== 'approved') throw new UserError('Only approved orders can be marked received.');
  if (o.created_by === c.userId || o.approved_by === c.userId) throw new UserError('Separation of duties: the person who raised or approved the order cannot confirm receipt.');
  if (note.trim().length < 3) throw new UserError('Say what was received (for example "all 10 units, checked").');
  await c.q.query(`update fin_purchase_orders set status = 'received', received_by = $2, received_at = now(), receipt_note = $3 where id = $1`, [id, c.userId, note.trim()]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'po.received', entity: 'purchase_order', entityId: id, after: { note: note.trim() }, ip: c.ip, userAgent: c.userAgent });
}

/** Turns a received order into a vendor bill (which then needs its own approval and payment). The bill amount is the order amount. */
export async function billOrder(c: Ctx, id: string, i: { categoryId: string; vat: boolean; dueDate: string }) {
  need(c, 'finance:create');
  const o = await load(c, id);
  if (o.status !== 'received') throw new UserError('Only received orders can be billed.');
  const inv = await createInvoice(c, { kind: 'payable', partyId: o.vendor_id, description: `${o.number}: ${o.description}`.slice(0, 300), categoryId: i.categoryId, issueDate: new Date().toISOString().slice(0, 10), dueDate: i.dueDate, subtotal: toDb(fromDb(o.subtotal)), vat: i.vat });
  await c.q.query(`update fin_purchase_orders set status = 'billed', invoice_id = $2 where id = $1`, [id, inv.id]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'po.billed', entity: 'purchase_order', entityId: id, after: { invoice: inv.number }, ip: c.ip, userAgent: c.userAgent });
  return inv;
}

export async function cancelOrder(c: Ctx, id: string, reason: string) {
  need(c, 'finance:create');
  const o = await load(c, id);
  if (!['draft', 'approved'].includes(o.status)) throw new UserError('Only orders not yet received can be cancelled.');
  if (reason.trim().length < 5) throw new UserError('Give a short reason.');
  await c.q.query(`update fin_purchase_orders set status = 'cancelled', cancel_reason = $2 where id = $1`, [id, reason.trim()]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'po.cancelled', entity: 'purchase_order', entityId: id, after: { reason: reason.trim() }, ip: c.ip, userAgent: c.userAgent });
}

const BASE = `select o.*, o.expected_on::text as expected, v.name as vendor, i.number as invoice_no from fin_purchase_orders o join fin_parties v on v.id = o.vendor_id left join fin_invoices i on i.id = o.invoice_id`;
const shape = (r: any) => ({ ...r, subtotalMinor: fromDb(r.subtotal) });
export async function listOrders(c: Ctx, status?: string) {
  need(c, 'finance:view');
  return (await c.q.query<any>(`${BASE} ${status ? 'where o.status = $1' : ''} order by o.created_at desc limit 200`, status ? [status] : [])).map(shape);
}
export async function getOrder(c: Ctx, id: string) {
  need(c, 'finance:view');
  const o = (await c.q.query<any>(`${BASE} where o.id = $1`, [id]))[0];
  return o ? shape(o) : null;
}
