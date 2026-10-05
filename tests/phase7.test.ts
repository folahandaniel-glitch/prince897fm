import { beforeAll, describe, expect, it } from 'vitest';
import { privileged, withTenant } from '../src/server/db';
import { seedOrganization, TEMPLATES } from '../src/server/seed';
import { runAs } from '../src/server/ctx';
import { ForbiddenError } from '../src/domain/policy';
import { carryOver, leaveEntitlement } from '../src/domain/leave';
import { isSealed, mask, seal, sealLegacy, unseal } from '../src/server/sensitive';
import { compensationFor, setCompensation } from '../src/server/payroll';
import { leaveOverview } from '../src/server/attendance';
import { listAccounts } from '../src/server/finance';
import { approveOrder, billOrder, cancelOrder, createOrder, getOrder, listOrders, receiveOrder } from '../src/server/orders';
import { approveInvoice, getInvoice } from '../src/server/invoices';

const ids: Record<string, string> = {};
const u: Record<string, string> = {};
const acct: Record<string, string> = {};
const as = <T>(who: string, fn: Parameters<typeof runAs<T>>[2]) => runAs(ids.org, u[who], fn);
const today = new Date().toISOString().slice(0, 10);

describe('leave entitlement rules', () => {
  it('pro-rates new joiners by remaining months (joining month counts when on or before the 15th)', () => {
    expect(leaveEntitlement({ annual: 24, joinedOn: '2026-03-10', year: 2026, prorate: true })).toBe(20);
    expect(leaveEntitlement({ annual: 24, joinedOn: '2026-03-20', year: 2026, prorate: true })).toBe(18);
    expect(leaveEntitlement({ annual: 20, joinedOn: '2026-12-31', year: 2026, prorate: true })).toBe(0);
    expect(leaveEntitlement({ annual: 20, joinedOn: '2026-03-10', year: 2026, prorate: false })).toBe(20);
    expect(leaveEntitlement({ annual: 20, joinedOn: '2025-03-10', year: 2026, prorate: true })).toBe(20);
    expect(leaveEntitlement({ annual: 20, joinedOn: '2027-01-01', year: 2026, prorate: true })).toBe(0);
    expect(leaveEntitlement({ annual: 0, joinedOn: '2026-03-10', year: 2026, prorate: true })).toBe(0);
  });
  it('rounds to half days and adds carry-in', () => {
    expect(leaveEntitlement({ annual: 20, joinedOn: '2026-08-01', year: 2026, prorate: true })).toBe(8.5); // 5/12 of 20 = 8.33
    expect(leaveEntitlement({ annual: 20, joinedOn: '2025-01-01', year: 2026, prorate: true, carryIn: 3 })).toBe(23);
  });
  it('carry-over is unused days capped by policy and never negative', () => {
    expect(carryOver(20, 12, 5)).toBe(5);
    expect(carryOver(20, 18, 5)).toBe(2);
    expect(carryOver(20, 25, 5)).toBe(0);
    expect(carryOver(20, 0, 0)).toBe(0);
  });
});

describe('field-level encryption', () => {
  it('seals, unseals, masks and tolerates legacy plaintext', () => {
    const s = seal('0123456789')!;
    expect(isSealed(s)).toBe(true);
    expect(s).not.toContain('0123456789');
    expect(unseal(s)).toBe('0123456789');
    expect(mask(s)).toBe('****6789');
    expect(unseal('plain-legacy')).toBe('plain-legacy');
    expect(mask('0123456789')).toBe('****6789');
    expect(seal('   ')).toBeNull();
    expect(unseal('enc:garbage.garbage.garbage')).toBeNull();
    expect(seal('0123456789')).not.toBe(s); // random IV: ciphertext differs each time
  });
});

beforeAll(async () => {
  const lines: string[] = [];
  for (const t of TEMPLATES) await seedOrganization(t, lines);
  const p = await privileged();
  ids.org = (await p.query<any>(`select id from organizations where slug = 'prince897'`))[0].id;
  const map: Record<string, string> = { officer: 'officer', officer2: 'payments', accountant: 'accountant', fm: 'finmanager', ceo: 'ceo', chairman: 'chairman', hr: 'hr', presenter: 'presenter' };
  for (const [k, e] of Object.entries(map)) u[k] = (await p.query<any>(`select u.id from users u join organizations o on o.id=u.org_id where o.slug='prince897' and u.email=$1`, [`${e}@prince897.example`]))[0].id;
  for (const a of await withTenant(ids.org, (q) => listAccounts(q))) acct[a.code] = a.id;
  ids.presenterEmp = (await p.query<any>(`select id from employees where user_id = $1`, [u.presenter]))[0].id;
});

describe('sensitive payroll identifiers at rest', () => {
  const comp = { basic: '300,000', housing: '100,000', transport: '50,000', others: [], pension: true, nhf: false, annualRent: '0', taxId: 'TIN-99887766', pensionPin: 'PEN100200300', bankName: 'GTBank', bankAccount: '0123456789', effectiveFrom: '2026-01-01' };
  it('stores sealed values, shows full details only to payroll managers, and audits the view', async () => {
    await as('hr', (c) => setCompensation(c, ids.presenterEmp, comp));
    const raw = (await (await privileged()).query<any>('select bank_account, tax_id, pension_pin from comp_profiles where employee_id = $1 and effective_to is null', [ids.presenterEmp]))[0];
    for (const v of Object.values(raw)) { expect(String(v).startsWith('enc:')).toBe(true); }
    expect(JSON.stringify(raw)).not.toContain('0123456789');
    const hr = (await as('hr', (c) => compensationFor(c, ids.presenterEmp))).cur!;
    expect([hr.bankAccount, hr.taxId, hr.pensionPin]).toEqual(['0123456789', 'TIN-99887766', 'PEN100200300']);
    const ceo = (await as('ceo', (c) => compensationFor(c, ids.presenterEmp))).cur!;
    expect([ceo.bankAccount, ceo.taxId]).toEqual(['****6789', '****7766']);
    const viewed = await (await privileged()).query<any>(`select count(*)::int n from audit_events where action = 'payroll.sensitive_viewed' and actor_user_id = $1`, [u.hr]);
    expect(viewed[0].n).toBeGreaterThan(0);
  });
  it('seals plaintext left over from before encryption', async () => {
    const p = await privileged();
    await p.query(`update comp_profiles set bank_account = '9999888877' where employee_id = $1 and effective_to is null`, [ids.presenterEmp]);
    expect(await withTenant(ids.org, (q) => sealLegacy(q))).toBe(1);
    expect(await withTenant(ids.org, (q) => sealLegacy(q))).toBe(0);
    expect((await as('hr', (c) => compensationFor(c, ids.presenterEmp))).cur!.bankAccount).toBe('9999888877');
  });
});

describe('leave carry-over and pro-rata in the app', () => {
  it('adds capped carry-over from last year to this year\'s entitlement', async () => {
    const p = await privileged();
    const typeId = (await p.query<any>(`select id from leave_types where org_id = $1 and name = 'Annual leave'`, [ids.org]))[0].id;
    const joined = (await p.query<any>(`select joined_on::text j from employees where id = $1`, [ids.presenterEmp]))[0].j;
    const y = new Date().getUTCFullYear();
    const before = (await as('presenter', (c) => leaveOverview(c))).balances.find((b: any) => b.id === typeId)!;
    expect(before.carryIn).toBe(0); // no carry policy yet
    await p.query(`update leave_types set carry_over_max = 5 where id = $1`, [typeId]);
    await p.query(`insert into leave_requests (org_id, employee_id, leave_type_id, start_date, end_date, days, status) values ($1,$2,$3,$4,$5,2,'approved')`, [ids.org, ids.presenterEmp, typeId, `${y - 1}-03-03`, `${y - 1}-03-04`]);
    const prevEnt = leaveEntitlement({ annual: 20, joinedOn: joined, year: y - 1, prorate: true });
    const expectedCarry = carryOver(prevEnt, 2, 5);
    const after = (await as('presenter', (c) => leaveOverview(c))).balances.find((b: any) => b.id === typeId)!;
    expect(after.carryIn).toBe(expectedCarry);
    expect(after.entitlement).toBe(leaveEntitlement({ annual: 20, joinedOn: joined, year: y, prorate: true, carryIn: expectedCarry }));
  });
});

describe('purchase orders', () => {
  let vendor: string; let po: { id: string; number: string };
  beforeAll(async () => { vendor = (await (await privileged()).query<any>(`insert into fin_parties (org_id, kind, name) values ($1,'vendor','Studio Supplies Ltd') returning id`, [ids.org]))[0].id; });
  it('requires raise -> approve -> receive by three different people, then bills', async () => {
    await expect(as('presenter', (c) => createOrder(c, { vendorId: vendor, description: 'Cables', subtotal: '90,000' }))).rejects.toBeInstanceOf(ForbiddenError);
    po = await as('officer', (c) => createOrder(c, { vendorId: vendor, description: 'XLR cables x40', subtotal: '90,000.00' }));
    expect(po.number).toMatch(/^PO-/);
    await expect(as('officer', (c) => approveOrder(c, po.id))).rejects.toBeInstanceOf(ForbiddenError); // finance officer cannot approve
    await expect(as('fm', (c) => receiveOrder(c, po.id, 'all there'))).rejects.toThrow(/approved orders/);
    await as('fm', (c) => approveOrder(c, po.id));
    await expect(as('fm', (c) => receiveOrder(c, po.id, 'all there'))).rejects.toThrow(/Separation of duties/); // approver cannot receive
    await expect(as('officer', (c) => receiveOrder(c, po.id, 'all there'))).rejects.toThrow(/Separation of duties/); // raiser cannot receive
    await expect(as('accountant', (c) => receiveOrder(c, po.id, ' '))).rejects.toThrow(/what was received/);
    await as('accountant', (c) => receiveOrder(c, po.id, 'All 40 cables, tested'));
    await expect(as('officer', (c) => cancelOrder(c, po.id, 'changed my mind'))).rejects.toThrow(/not yet received/);
    const inv = await as('officer', (c) => billOrder(c, po.id, { categoryId: acct['5010'], vat: true, dueDate: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10) }));
    expect((await as('officer', (c) => getOrder(c, po.id)))!.status).toBe('billed');
    const d = await as('officer', (c) => getInvoice(c, inv.id));
    expect([d.inv.kind, d.inv.status, d.inv.subtotalMinor]).toEqual(['payable', 'pending', 90_000_00]);
    await expect(as('officer', (c) => billOrder(c, po.id, { categoryId: acct['5010'], vat: false, dueDate: today }))).rejects.toThrow(/Only received/);
    await as('fm', (c) => approveInvoice(c, inv.id)); // the bill continues through the normal payable controls
  });
  it('can be cancelled before receipt and lists by status', async () => {
    const o = await as('officer', (c) => createOrder(c, { vendorId: vendor, description: 'Spare mixer', subtotal: '10,000' }));
    await expect(as('officer', (c) => cancelOrder(c, o.id, 'no'))).rejects.toThrow(/short reason/);
    await as('officer', (c) => cancelOrder(c, o.id, 'No longer needed'));
    expect((await as('accountant', (c) => listOrders(c, 'cancelled'))).map((x: any) => x.id)).toContain(o.id);
    await expect(as('presenter', (c) => listOrders(c))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('officer', (c) => createOrder(c, { vendorId: 'bad', description: 'x y z', subtotal: '1' }))).rejects.toThrow();
  });
});
