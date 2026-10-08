import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import type { Q } from './db';
import { fromDb, MoneyError, parseMoney, toDb } from '../domain/finance';
import { notify } from './hr';

/** Client contracts built from templates with merge fields, tracked from draft to signed, with renewal alerts. */
export const MERGE_FIELDS = ['client', 'title', 'value', 'starts', 'ends', 'company', 'date'] as const;
const STARTER: [string, string][] = [
  ['Advertising agreement', 'ADVERTISING AGREEMENT\n\nThis agreement is made on {{date}} between {{company}} ("the Station") and {{client}} ("the Client").\n\n1. Services. The Station will broadcast the Client\'s advertising as set out in the schedule agreed for "{{title}}".\n2. Term. From {{starts}} to {{ends}}.\n3. Fees. The Client will pay {{value}} for the term, against invoices issued by the Station.\n4. Content. The Client is responsible for the truth of its advertisements. The Station may refuse any material that breaches broadcasting regulations.\n5. Cancellation. Either party may end this agreement with 14 days\' written notice; fees for airtime already broadcast remain payable.\n\nSigned for the Station: ____________________    Signed for the Client: ____________________'],
  ['Sponsorship agreement', 'SPONSORSHIP AGREEMENT\n\nBetween {{company}} and {{client}}, dated {{date}}.\n\nThe Client sponsors "{{title}}" from {{starts}} to {{ends}} for {{value}}. The Station will acknowledge the sponsor on air as agreed in writing. Payment terms: as invoiced.\n\nSigned for the Station: ____________________    Signed for the Client: ____________________'],
];
const money = (s: string) => { try { return s.trim() === '' ? 0 : parseMoney(s); } catch (e) { if (e instanceof MoneyError) throw new UserError(e.message); throw e; } };

/** Replaces {{field}} placeholders. Only the known fields are filled; anything else is left as written. */
export function fillContract(body: string, v: Record<(typeof MERGE_FIELDS)[number], string>): string {
  return body.replace(/\{\{\s*([a-z]+)\s*\}\}/g, (m, k: string) => ((MERGE_FIELDS as readonly string[]).includes(k) ? v[k as (typeof MERGE_FIELDS)[number]] : m));
}

export async function ensureStarterTemplates(c: Ctx) {
  need(c, 'contract:manage');
  for (const [name, body] of STARTER) await c.q.query('insert into contract_templates (org_id, name, body, created_by) values ($1,$2,$3,$4) on conflict (org_id, name) do nothing', [c.orgId, name, body, c.userId]);
}
export async function listTemplates(c: Ctx) {
  need(c, 'contract:view');
  return c.q.query<any>('select id, name, body, active from contract_templates order by active desc, name');
}
export async function saveTemplate(c: Ctx, i: { id?: string; name: string; body: string; active?: boolean }) {
  need(c, 'contract:manage');
  if (i.name.trim().length < 2) throw new UserError('Give the template a name.');
  if (i.body.trim().length < 10) throw new UserError('The template text is too short.');
  if (i.id) {
    const r = await c.q.query('update contract_templates set name=$2, body=$3, active=$4 where id=$1 returning id', [i.id, i.name.trim(), i.body, i.active ?? true]);
    if (!r[0]) throw new UserError('Template not found.');
  } else {
    if ((await c.q.query('select 1 from contract_templates where lower(name) = lower($1)', [i.name.trim()]))[0]) throw new UserError('A template with that name already exists.');
    await c.q.query('insert into contract_templates (org_id, name, body, created_by) values ($1,$2,$3,$4)', [c.orgId, i.name.trim(), i.body, c.userId]);
  }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: i.id ? 'contract.template_updated' : 'contract.template_created', entity: 'contract_template', entityId: i.id ?? i.name.trim(), after: { name: i.name.trim() }, ip: c.ip, userAgent: c.userAgent });
}

async function nextNumber(c: Ctx) {
  await c.q.query('select pg_advisory_xact_lock(hashtext($1))', [`contract:${c.orgId}`]);
  const r = await c.q.query<{ n: number }>(`select coalesce(max(substring(number from '[0-9]+$')::int), 0) + 1 as n from contracts`);
  return `CON-${String(r[0].n).padStart(5, '0')}`;
}

export async function createContract(c: Ctx, i: { accountId: string; templateId?: string; title: string; value?: string; startsOn: string; endsOn: string }) {
  need(c, 'contract:manage');
  const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
  if (i.title.trim().length < 2) throw new UserError('Give the contract a title.');
  if (!ok(i.startsOn) || !ok(i.endsOn) || i.endsOn < i.startsOn) throw new UserError('Enter valid start and end dates; the end cannot be before the start.');
  const acc = (await c.q.query<any>('select id, name from crm_accounts where id = $1', [i.accountId]))[0];
  if (!acc) throw new UserError('Choose a client.');
  const tpl = i.templateId ? (await c.q.query<any>('select id, body from contract_templates where id = $1 and active', [i.templateId]))[0] : null;
  if (i.templateId && !tpl) throw new UserError('Unknown template.');
  const value = money(i.value ?? '');
  const company = (await c.q.query<{ name: string }>('select name from organizations where id = $1', [c.orgId]))[0].name;
  const fmt = (n: number) => `₦${(n / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
  const body = fillContract(tpl?.body ?? 'CONTRACT\n\n{{company}} and {{client}}: {{title}}, {{starts}} to {{ends}}, {{value}}.', { client: acc.name, title: i.title.trim(), value: fmt(value), starts: i.startsOn, ends: i.endsOn, company, date: new Date().toISOString().slice(0, 10) });
  const number = await nextNumber(c);
  const r = await c.q.query<{ id: string }>('insert into contracts (org_id, number, account_id, template_id, title, body, value, starts_on, ends_on, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id', [c.orgId, number, acc.id, tpl?.id ?? null, i.title.trim(), body, toDb(value), i.startsOn, i.endsOn, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'contract.created', entity: 'contract', entityId: r[0].id, after: { number, client: acc.name, value: toDb(value) }, ip: c.ip, userAgent: c.userAgent });
  return { id: r[0].id, number };
}

export async function listContracts(c: Ctx, status?: string) {
  need(c, 'contract:view');
  const rows = await c.q.query<any>(`select k.id, k.number, k.title, k.value, k.starts_on::text as starts_on, k.ends_on::text as ends_on, k.status, k.signed_on::text as signed_on, a.name as client, a.id as account_id,
      case when k.status = 'signed' and k.ends_on < current_date then 'expired' else k.status end as effective
    from contracts k join crm_accounts a on a.id = k.account_id ${status ? 'where k.status = $1' : ''} order by k.created_at desc limit 200`, status ? [status] : []);
  return rows.map((r) => ({ ...r, valueMinor: fromDb(r.value) }));
}

export async function getContract(c: Ctx, id: string) {
  need(c, 'contract:view');
  const k = (await c.q.query<any>(`select k.*, k.starts_on::text as starts_s, k.ends_on::text as ends_s, k.signed_on::text as signed_s, a.name as client from contracts k join crm_accounts a on a.id = k.account_id where k.id = $1`, [id]))[0];
  return k ? { ...k, valueMinor: fromDb(k.value) } : null;
}

export async function setContractStatus(c: Ctx, id: string, action: 'send' | 'sign' | 'cancel', i: { signedBy?: string; signedOn?: string } = {}) {
  need(c, 'contract:manage');
  const k = (await c.q.query<any>('select * from contracts where id = $1 for update', [id]))[0];
  if (!k) throw new UserError('Contract not found.');
  if (action === 'send') {
    if (k.status !== 'draft') throw new UserError('Only a draft can be marked as sent.');
    await c.q.query(`update contracts set status = 'sent' where id = $1`, [id]);
  } else if (action === 'sign') {
    if (!['draft', 'sent'].includes(k.status)) throw new UserError('This contract cannot be marked as signed.');
    if ((i.signedBy?.trim().length ?? 0) < 2) throw new UserError('Enter the name of the person who signed for the client.');
    const on = i.signedOn && /^\d{4}-\d{2}-\d{2}$/.test(i.signedOn) ? i.signedOn : new Date().toISOString().slice(0, 10);
    await c.q.query(`update contracts set status = 'signed', signed_on = $2, signed_by_name = $3 where id = $1`, [id, on, i.signedBy!.trim()]);
  } else {
    if (['cancelled', 'expired'].includes(k.status)) throw new UserError('Already closed.');
    await c.q.query(`update contracts set status = 'cancelled' where id = $1`, [id]);
  }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: `contract.${action}`, entity: 'contract', entityId: id, ip: c.ip, userAgent: c.userAgent });
}

/** Cron: tell the contract owner when a signed contract is within 30 days of ending (once per contract and stage). */
export async function contractAlerts(q: Q, orgId: string): Promise<number> {
  const rows = await q.query<any>(`select k.id, k.number, k.title, k.created_by, k.ends_on::text as ends, (k.ends_on - current_date) as left, a.name from contracts k join crm_accounts a on a.id = k.account_id where k.status = 'signed' and k.ends_on between current_date - 1 and current_date + 30`);
  let n = 0;
  for (const r of rows) {
    const stage = r.left <= 7 ? 'w1' : 'w4';
    const x = await q.query(`insert into notifications (org_id, user_id, title, body, href, dedupe_key) values ($1,$2,$3,$4,$5,$6) on conflict do nothing returning id`, [orgId, r.created_by, `Contract ending soon: ${r.name}`, `${r.number} ${r.title} ends on ${r.ends}. Agree a renewal.`, `/contracts/${r.id}`, `contract:${r.id}:${stage}`]);
    if (x[0]) n++;
  }
  void notify;
  return n;
}
