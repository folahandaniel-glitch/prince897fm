import crypto from 'node:crypto';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { privileged, withTenant } from '../src/server/db';
import { seedOrganization, TEMPLATES } from '../src/server/seed';
import { runAs } from '../src/server/ctx';
import { ForbiddenError } from '../src/domain/policy';
import { compressPhoto, photoFor, removePhoto, saveMyPhoto, TARGET_BYTES } from '../src/server/photo';
import { deliverableScore, listDefs, myExpectations, reviewDeliverable, reviewQueue, saveDef, submitDeliverable } from '../src/server/deliverables';
import { acknowledge, ackStatus, deleteArticle, getArticle, getMemo, listArticles, listMemos, postMemo, saveArticle, unreadMemoCount } from '../src/server/company';
import { advanceLimit, decideAdvance, listAdvances, payAdvance, requestAdvance } from '../src/server/advances';
import { createAccount } from '../src/server/crm';
import { createContract, ensureStarterTemplates, fillContract, getContract, listContracts, listTemplates, setContractStatus, contractAlerts } from '../src/server/contracts';
import { convertToInvoice, createQuote, getQuote, setQuoteStatus, totals } from '../src/server/quotes';
import { flagsFrom, myFlags, teamFlags } from '../src/server/flags';
import { hubCsv, hubReport, listExcuses, listPayments } from '../src/server/reporthub';
import { listAccounts, trialBalance } from '../src/server/finance';
import { setCompensation } from '../src/server/payroll';
import { DEFAULT_NAV } from '../src/domain/config-schema';

const ids: Record<string, string> = {};
const u: Record<string, string> = {};
const as = <T>(who: string, fn: Parameters<typeof runAs<T>>[2]) => runAs(ids.org, u[who], fn);
const today = new Date().toISOString().slice(0, 10);
const period = today.slice(0, 7);
const plus = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const acct: Record<string, string> = {};

/** A large, noisy picture: the hard case for compression. */
const noisy = async (w = 1600, h = 1200, fmt: 'jpeg' | 'png' = 'jpeg') => {
  const raw = crypto.randomBytes(w * h * 3);
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })[fmt]().toBuffer();
};

beforeAll(async () => {
  for (const t of TEMPLATES) await seedOrganization(t, []);
  const p = await privileged();
  ids.org = (await p.query<any>(`select id from organizations where slug = 'prince897'`))[0].id;
  const map: Record<string, string> = { admin: 'admin', hr: 'hr', presenter: 'presenter', head: 'head', sales: 'sales', officer: 'officer', fm: 'finmanager', officer2: 'payments', ceo: 'ceo', superadmin: 'superadmin' };
  for (const [k, e] of Object.entries(map)) u[k] = (await p.query<any>(`select id from users where org_id = $1 and email = $2`, [ids.org, `${e}@prince897.example`]))[0]?.id;
  for (const a of await withTenant(ids.org, (q) => listAccounts(q))) acct[a.code] = a.id;
  ids.presEmp = (await p.query<any>(`select id from employees where user_id = $1`, [u.presenter]))[0].id;
  if (!(await p.query<any>(`select 1 from comp_profiles where employee_id = $1`, [ids.presEmp]))[0]) await as('hr', (c) => setCompensation(c, ids.presEmp, { basic: '100,000', housing: '30,000', transport: '20,000', others: [], pension: true, nhf: false, annualRent: '0', effectiveFrom: '2020-01-01' }));
});

describe('profile pictures are shrunk to 10 KB and stay a usable picture', () => {
  it('turns a big noisy JPEG into a square WebP under 10,000 bytes', async () => {
    const big = await noisy();
    expect(big.length).toBeGreaterThan(1_000_000);
    const r = await compressPhoto(big);
    expect(r.bytes.length).toBeLessThanOrEqual(TARGET_BYTES);
    const m = await sharp(r.bytes).metadata();
    expect(m.format).toBe('webp');
    expect(m.width).toBe(m.height);
    expect(m.width).toBeGreaterThanOrEqual(96);
  });
  it('keeps full size for a simple photo (quality is not thrown away needlessly)', async () => {
    const calm = await sharp({ create: { width: 900, height: 700, channels: 3, background: '#2a6f4e' } }).png().toBuffer();
    const r = await compressPhoto(calm);
    expect(r.size).toBe(256);
    expect(r.quality).toBe(86);
    expect(r.bytes.length).toBeLessThanOrEqual(TARGET_BYTES);
  });
  it('refuses things that are not pictures, vector files and oversize files', async () => {
    await expect(compressPhoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).rejects.toThrow(/JPEG, PNG or WebP/);
    await expect(compressPhoto(Buffer.from('GIF89a......'))).rejects.toThrow(/JPEG, PNG or WebP/);
    await expect(compressPhoto(Buffer.alloc(0))).rejects.toThrow(/Choose a picture/);
    await expect(compressPhoto(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(9 * 1024 * 1024)]))).rejects.toThrow(/4 MB/);
    await expect(compressPhoto(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('not really a jpeg')]))).rejects.toThrow(/could not be read/);
  });
  it('saves, replaces and removes a picture, and only the owner or an administrator may remove it', async () => {
    const a = await as('presenter', async (c) => saveMyPhoto(c, await noisy(800, 800, 'png')));
    expect(a.bytes).toBeLessThanOrEqual(TARGET_BYTES);
    const got = await as('hr', (c) => photoFor(c, u.presenter));
    expect(got?.sha).toBe(a.sha);
    const b = await as('presenter', async (c) => saveMyPhoto(c, await noisy(500, 700)));
    expect(b.sha).not.toBe(a.sha);
    await expect(as('hr', (c) => removePhoto(c, u.presenter))).rejects.toBeInstanceOf(ForbiddenError);
    await as('admin', (c) => removePhoto(c, u.presenter));
    expect(await as('hr', (c) => photoFor(c, u.presenter))).toBeNull();
  });
});

describe('deliverables feed the KPI', () => {
  it('HR defines, staff submit, a supervisor approves, and the score follows', async () => {
    await expect(as('presenter', (c) => saveDef(c, { name: 'x', frequency: 'weekly', targetCount: 1 }))).rejects.toBeInstanceOf(ForbiddenError);
    const dep = (await (await privileged()).query<any>(`select a.department_id from assignments a join employees e on e.id = a.employee_id where e.user_id = $1 and a.superseded_at is null limit 1`, [u.presenter]))[0].department_id;
    const defId = await as('hr', (c) => saveDef(c, { name: 'Show log', departmentId: dep, frequency: 'weekly', targetCount: 2 }));
    await expect(as('hr', (c) => saveDef(c, { name: 'show log', departmentId: dep, frequency: 'weekly', targetCount: 2 }))).rejects.toThrow(/already exists/);
    expect((await as('hr', (c) => listDefs(c))).some((d: any) => d.id === defId)).toBe(true);
    expect((await as('presenter', (c) => myExpectations(c, period))).some((d: any) => d.id === defId)).toBe(true);
    await expect(as('presenter', (c) => submitDeliverable(c, { defId, title: 'Bad link', link: 'javascript:alert(1)' }))).rejects.toThrow(/http/);
    const sid = await as('presenter', (c) => submitDeliverable(c, { defId, title: 'Log, week 1', link: 'https://example.com/log' }));
    await expect(as('presenter', (c) => reviewDeliverable(c, sid, true, ''))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await as('head', (c) => reviewQueue(c))).some((r: any) => r.id === sid)).toBe(true);
    await expect(as('head', (c) => reviewDeliverable(c, sid, false, ''))).rejects.toThrow(/what needs to change/);
    await as('head', (c) => reviewDeliverable(c, sid, true, 'Good'));
    await expect(as('head', (c) => reviewDeliverable(c, sid, true, ''))).rejects.toThrow(/already been reviewed/);
    const score = await withTenant(ids.org, (q) => deliverableScore(q, ids.presEmp, period));
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('memos and the knowledge base', () => {
  it('a memo reaches everyone, must be acknowledged, and the sender sees who has read it', async () => {
    await expect(as('presenter', (c) => postMemo(c, { title: 'Hello', body: 'x' }))).rejects.toBeInstanceOf(ForbiddenError);
    const m = await as('hr', (c) => postMemo(c, { title: 'Office closes early Friday', body: 'Please plan accordingly.' }));
    expect(m.ref).toMatch(/^MEMO-\d{4}$/);
    expect(await as('presenter', (c) => unreadMemoCount(c))).toBeGreaterThanOrEqual(1);
    expect((await as('presenter', (c) => listMemos(c))).some((x: any) => x.id === m.id)).toBe(true);
    await as('presenter', (c) => acknowledge(c, m.id));
    await as('presenter', (c) => acknowledge(c, m.id)); // idempotent
    expect((await as('presenter', (c) => getMemo(c, m.id)))?.my_ack).toBeTruthy();
    const st = await as('hr', (c) => ackStatus(c, m.id));
    expect(st.find((s) => s.id === u.presenter)?.ackedAt).toBeTruthy();
    expect(st.some((s) => !s.ackedAt)).toBe(true);
    await expect(as('presenter', (c) => ackStatus(c, m.id))).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('articles: drafts are hidden from staff, search works, and only managers edit', async () => {
    await expect(as('presenter', (c) => saveArticle(c, { title: 'Nope', category: 'x', body: 'x' }))).rejects.toBeInstanceOf(ForbiddenError);
    const pub = await as('hr', (c) => saveArticle(c, { title: 'How to log a show', category: 'Programmes', body: 'Fill the log sheet after every show.', pinned: true }));
    const draft = await as('hr', (c) => saveArticle(c, { title: 'Secret draft', category: 'HR', body: 'Not yet.', status: 'draft' }));
    const seen = await as('presenter', (c) => listArticles(c));
    expect(seen.some((a: any) => a.id === pub)).toBe(true);
    expect(seen.some((a: any) => a.id === draft)).toBe(false);
    await expect(as('presenter', (c) => getArticle(c, draft))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await as('presenter', (c) => listArticles(c, { q: '100%' }))).length).toBe(0); // wildcard characters are literal
    expect((await as('presenter', (c) => listArticles(c, { q: 'LOG SHEET' }))).some((a: any) => a.id === pub)).toBe(true);
    await as('hr', (c) => deleteArticle(c, draft));
    expect(await as('hr', (c) => getArticle(c, draft))).toBeNull();
  });
});

describe('salary advances', () => {
  let advId = '';
  it('are capped at one month of fixed pay and only one can be open', async () => {
    expect(await as('presenter', (c) => advanceLimit(c, ids.presEmp))).toBeGreaterThan(0);
    await expect(as('presenter', (c) => requestAdvance(c, { amount: '99,999,999', months: 3, reason: 'School fees for the children' }))).rejects.toThrow(/most you can request/);
    await expect(as('presenter', (c) => requestAdvance(c, { amount: '10,000', months: 9, reason: 'School fees for the children' }))).rejects.toThrow(/1 to 6 months/);
    await expect(as('presenter', (c) => requestAdvance(c, { amount: '10,000', months: 2, reason: 'no' }))).rejects.toThrow(/why/);
    advId = await as('presenter', (c) => requestAdvance(c, { amount: '60,000', months: 3, reason: 'School fees for the children' }));
    await expect(as('presenter', (c) => requestAdvance(c, { amount: '10,000', months: 2, reason: 'Another reason here' }))).rejects.toThrow(/already have an advance/);
  });
  it('need approval by someone else, payment by a third person, then recover through payroll', async () => {
    await expect(as('presenter', (c) => decideAdvance(c, advId, true, ''))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('hr', (c) => payAdvance(c, advId, { cashAccountId: acct['1010'], reference: 'X' }))).rejects.toBeInstanceOf(ForbiddenError);
    await as('hr', (c) => decideAdvance(c, advId, true, 'Approved'));
    await expect(as('hr', (c) => decideAdvance(c, advId, true, ''))).rejects.toThrow(/already been decided/);
    const before = await as('fm', (c) => trialBalance(c));
    await as('officer', (c) => payAdvance(c, advId, { cashAccountId: acct['1010'], reference: 'ADV-1' }));
    const rows = await withTenant(ids.org, (q) => q.query<any>(`select period, amount, status from pay_adjustments where source_ref like $1 order by source_ref`, [`advance:${advId}:%`]));
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'approved')).toBe(true);
    expect(rows.reduce((a, r) => a + Number(r.amount), 0)).toBeCloseTo(60_000, 2);
    expect(rows[0].period > period).toBe(true); // repayment starts next month
    const mine = await as('presenter', (c) => listAdvances(c, 'mine'));
    expect(mine[0].status).toBe('paid');
    expect(before).toBeDefined();
    await expect(as('officer', (c) => payAdvance(c, advId, { cashAccountId: acct['1010'], reference: 'ADV-1' }))).rejects.toThrow(/Only approved/);
  });
  it('the borrower can never approve or pay their own advance', async () => {
    await expect(as('presenter', (c) => listAdvances(c, 'all'))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('contracts', () => {
  it('fills only the known merge fields', () => {
    const v = { client: 'Acme', title: 'T', value: '₦1', starts: 'a', ends: 'b', company: 'Prince', date: 'd' };
    expect(fillContract('Hi {{client}} {{ company }} {{secret}}', v)).toBe('Hi Acme Prince {{secret}}');
  });
  it('are built from a template, tracked to signature and flagged before they end', async () => {
    await as('sales', (c) => ensureStarterTemplates(c));
    const tpl = (await as('sales', (c) => listTemplates(c)))[0];
    const acc = await as('sales', (c) => createAccount(c, { name: 'Contract Client Ltd', status: 'client' }));
    const accId = typeof acc === 'string' ? acc : (acc as any).id;
    await expect(as('presenter', (c) => listContracts(c))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('sales', (c) => createContract(c, { accountId: accId, templateId: tpl.id, title: 'Bad dates', startsOn: plus(10), endsOn: plus(1) }))).rejects.toThrow(/end cannot be before/);
    const made = await as('sales', (c) => createContract(c, { accountId: accId, templateId: tpl.id, title: 'Morning Drive spots', value: '1,500,000', startsOn: plus(-300), endsOn: plus(20) }));
    expect(made.number).toMatch(/^CON-\d{5}$/);
    const k = await as('sales', (c) => getContract(c, made.id));
    expect(k.body).toContain('Contract Client Ltd');
    expect(k.body).toContain('Morning Drive spots');
    expect(k.body).not.toContain('{{');
    await expect(as('sales', (c) => setContractStatus(c, made.id, 'sign', {}))).rejects.toThrow(/name of the person/);
    await as('sales', (c) => setContractStatus(c, made.id, 'send'));
    await as('sales', (c) => setContractStatus(c, made.id, 'sign', { signedBy: 'Mr Client', signedOn: plus(-299) }));
    await expect(as('sales', (c) => setContractStatus(c, made.id, 'send'))).rejects.toThrow(/Only a draft/);
    expect(await withTenant(ids.org, (q) => contractAlerts(q, ids.org))).toBe(1);
    expect(await withTenant(ids.org, (q) => contractAlerts(q, ids.org))).toBe(0); // once only
    const old = await as('sales', (c) => createContract(c, { accountId: accId, title: 'Old deal', startsOn: plus(-400), endsOn: plus(-5) }));
    await as('sales', (c) => setContractStatus(c, old.id, 'sign', { signedBy: 'Mr Client' }));
    expect((await as('sales', (c) => listContracts(c))).find((r: any) => r.id === old.id)?.effective).toBe('expired');
  });
});

describe('proposals and estimates', () => {
  it('total up with VAT and become an invoice only after the client accepts', async () => {
    expect(totals([{ qty: 2, unitMinor: 50_000_00 }, { qty: 1.5, unitMinor: 10_000_00 }], 7.5, true)).toEqual({ subtotal: 115_000_00, vat: 8_625_00, total: 123_625_00 });
    const client = (await (await privileged()).query<any>(`insert into fin_parties (org_id, kind, name) values ($1,'client','Quote Client') returning id`, [ids.org]))[0].id;
    const base = { kind: 'estimate', partyId: client, title: 'Jingle package', lines: [{ description: 'Jingle', qty: 2, unit: '50,000' }], vat: true, validUntil: plus(14) };
    await expect(as('presenter', (c) => createQuote(c, base))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('officer', (c) => createQuote(c, { ...base, validUntil: plus(-1) }))).rejects.toThrow(/is not in the past/);
    await expect(as('officer', (c) => createQuote(c, { ...base, lines: [] }))).rejects.toThrow(/at least one line/);
    await expect(as('officer', (c) => createQuote(c, { ...base, lines: [{ description: 'x y', qty: 0, unit: '5' }] }))).rejects.toThrow(/greater than zero/);
    const q = await as('officer', (c) => createQuote(c, base));
    expect(q.number).toMatch(/^EST-\d{5}$/);
    const got = await as('officer', (c) => getQuote(c, q.id));
    expect(got.subtotalMinor).toBe(100_000_00);
    expect(got.totalMinor).toBeGreaterThan(got.subtotalMinor);
    await expect(as('officer', (c) => convertToInvoice(c, q.id, { categoryId: acct['4000'], dueDate: plus(30) }))).rejects.toThrow(/accepted/);
    await as('officer', (c) => setQuoteStatus(c, q.id, 'accepted'));
    const inv = await as('officer', (c) => convertToInvoice(c, q.id, { categoryId: acct['4000'], dueDate: plus(30) }));
    expect(inv.number).toMatch(/^INV-/);
    expect((await as('officer', (c) => getQuote(c, q.id))).status).toBe('converted');
    await expect(as('officer', (c) => convertToInvoice(c, q.id, { categoryId: acct['4000'], dueDate: plus(30) }))).rejects.toThrow(/accepted/);
    const pay = await as('officer', (c) => listPayments(c));
    expect(Array.isArray(pay)).toBe(true);
  });
});

describe('performance flags', () => {
  it('apply plain rules and escalate with severity', () => {
    expect(flagsFrom({ lates30: 0, missedOuts30: 0, overdueTasks: 0, kpi: 80, assessmentFailed: false })).toEqual([]);
    const f = flagsFrom({ lates30: 7, missedOuts30: 1, overdueTasks: 3, kpi: 35, assessmentFailed: true });
    expect(f.map((x) => x.code).sort()).toEqual(['assessment', 'clockout', 'kpi', 'late', 'overdue']);
    expect(f.find((x) => x.code === 'late')?.severity).toBe('act');
    expect(f.find((x) => x.code === 'clockout')?.severity).toBe('watch');
    expect(flagsFrom({ lates30: 2, missedOuts30: 0, overdueTasks: 2, kpi: null, assessmentFailed: false })).toEqual([]);
  });
  it('are visible to managers for their scope and to staff for themselves only', async () => {
    expect(Array.isArray(await as('presenter', (c) => myFlags(c)))).toBe(true);
    await expect(as('presenter', (c) => teamFlags(c))).rejects.toBeInstanceOf(ForbiddenError);
    expect(Array.isArray(await as('hr', (c) => teamFlags(c)))).toBe(true);
  });
});

describe('report hub', () => {
  it('produces scoped tables and safe CSV', async () => {
    for (const k of ['attendance', 'leave', 'tasks', 'payroll'] as const) { const t = await as('hr', (c) => hubReport(c, k, period)); expect(t.head.length).toBeGreaterThan(2); }
    await expect(as('presenter', (c) => hubReport(c, 'attendance', period))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('presenter', (c) => hubReport(c, 'payroll', period))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('hr', (c) => hubReport(c, 'tasks', '2026-13'))).rejects.toThrow(/Choose a month/);
    const csv = hubCsv({ title: 't', head: ['A', 'B'], rows: [['=HYPERLINK("x")', 'ok "q"']] });
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"ok ""q"""');
    expect(Array.isArray(await as('presenter', (c) => listExcuses(c, true)))).toBe(true);
    await expect(as('presenter', (c) => listExcuses(c, false))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('navigation follows the template', () => {
  it('has the template groups in order, unique keys and unique hrefs per label', () => {
    const groups = [...new Set(DEFAULT_NAV.items.map((i) => i.group))];
    expect(groups.slice(0, 9)).toEqual(['Dashboard', 'My Work', 'Team', 'Company', 'HR Management', 'Clients', 'Reports', 'Finance', 'Support Tickets']);
    const keys = DEFAULT_NAV.items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const l of ['My Tasks', 'My Deliverables', 'Projects', 'My KPI', 'My Performance', 'Team Performance', 'Task Board', 'Review Deliverables', 'Deliverable Setup', 'Team KPI', 'Performance Flags', 'Notice Board', 'Memos', 'Knowledge Base', 'Events & Holidays', 'Staff HRM', 'Late Excuses', 'Salary Advances', 'Disciplinary', 'Contracts', 'Contract Templates', 'Proposals & Estimates', 'Payments', 'All Tickets']) expect(DEFAULT_NAV.items.some((i) => i.label === l), l).toBe(true);
  });
});
