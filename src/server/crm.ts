import { toDb, fromDb, parseMoney, MoneyError } from '../domain/finance';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import type { Q } from './db';
import { notify } from './hr';

export const STAGES = ['new', 'contacted', 'proposal', 'negotiation', 'won', 'lost'] as const;
export const STAGE_LABEL: Record<string, string> = { new: 'New', contacted: 'Contacted', proposal: 'Proposal sent', negotiation: 'Negotiation', won: 'Won', lost: 'Lost' };
const money = (s: string) => { try { return parseMoney(s); } catch (e) { if (e instanceof MoneyError) throw new UserError(e.message); throw e; } };
const dateOk = (s?: string | null) => !s || (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)));

export async function createAccount(c: Ctx, i: { name: string; kind?: string; status?: string; industry?: string; phone?: string; email?: string; address?: string; source?: string; notes?: string; contactName?: string; contactPhone?: string; contactEmail?: string }) {
  need(c, 'crm:manage');
  const name = i.name.trim();
  if (name.length < 2) throw new UserError('Enter a name.');
  if (i.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(i.email.trim())) throw new UserError('Enter a valid email address.');
  if ((await c.q.query('select 1 from crm_accounts where lower(name) = lower($1)', [name]))[0]) throw new UserError('An account with this name already exists. Open it instead of creating a duplicate.');
  const status = ['lead', 'prospect', 'client', 'inactive'].includes(i.status ?? '') ? i.status : 'lead';
  const r = await c.q.query<{ id: string }>(
    `insert into crm_accounts (org_id, name, kind, status, industry, phone, email, address, source, notes, owner_user_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) returning id`,
    [c.orgId, name, i.kind === 'individual' ? 'individual' : 'company', status, i.industry || null, i.phone || null, i.email?.trim().toLowerCase() || null, i.address || null, i.source || null, i.notes || null, c.userId]);
  if (i.contactName?.trim()) await c.q.query('insert into crm_contacts (org_id, account_id, name, phone, email, is_primary) values ($1,$2,$3,$4,$5,true)', [c.orgId, r[0].id, i.contactName.trim(), i.contactPhone || null, i.contactEmail || null]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'crm.account_created', entity: 'crm_account', entityId: r[0].id, after: { name, status }, ip: c.ip, userAgent: c.userAgent });
  return r[0].id;
}

export async function listAccounts(c: Ctx, f: { status?: string; q?: string } = {}) {
  need(c, 'crm:view');
  const where: string[] = []; const p: unknown[] = [];
  if (f.status) { p.push(f.status); where.push(`a.status = $${p.length}`); }
  if (f.q) { p.push(`%${f.q.toLowerCase()}%`); where.push(`(lower(a.name) like $${p.length} or lower(coalesce(a.email,'')) like $${p.length})`); }
  return c.q.query<any>(
    `select a.id, a.name, a.status, a.industry, a.phone, a.email, u.email as owner,
            (select coalesce(sum(o.value),0) from crm_opportunities o where o.account_id = a.id and o.stage not in ('won','lost')) as open_value,
            (select min(x.follow_up_on) from crm_activities x where x.account_id = a.id and x.follow_up_on is not null and not x.follow_up_done)::text as next_follow_up
       from crm_accounts a left join users u on u.id = a.owner_user_id ${where.length ? 'where ' + where.join(' and ') : ''} order by a.created_at desc limit 200`, p);
}

export async function getAccount(c: Ctx, id: string) {
  need(c, 'crm:view');
  const a = (await c.q.query<any>('select a.*, u.email as owner from crm_accounts a left join users u on u.id = a.owner_user_id where a.id = $1', [id]))[0];
  if (!a) return null;
  const [contacts, opps, acts, tickets] = await Promise.all([
    c.q.query<any>('select * from crm_contacts where account_id = $1 order by is_primary desc, name', [id]),
    c.q.query<any>('select *, expected_close::text as ec from crm_opportunities where account_id = $1 order by created_at desc', [id]),
    c.q.query<any>('select x.*, x.follow_up_on::text as fu, u.email as by_email from crm_activities x join users u on u.id = x.by_user where x.account_id = $1 order by x.occurred_at desc limit 60', [id]),
    c.q.query<any>('select id, number, subject, status from tickets where account_id = $1 order by created_at desc limit 10', [id]),
  ]);
  return { a, contacts, opps: opps.map((o) => ({ ...o, valueMinor: fromDb(o.value) })), acts, tickets };
}

export async function addContact(c: Ctx, accountId: string, i: { name: string; title?: string; phone?: string; email?: string }) {
  need(c, 'crm:manage');
  if (i.name.trim().length < 2) throw new UserError('Enter the contact\'s name.');
  if (!(await c.q.query('select 1 from crm_accounts where id = $1', [accountId]))[0]) throw new UserError('Account not found.');
  await c.q.query('insert into crm_contacts (org_id, account_id, name, title, phone, email) values ($1,$2,$3,$4,$5,$6)', [c.orgId, accountId, i.name.trim(), i.title || null, i.phone || null, i.email || null]);
}

export async function logActivity(c: Ctx, accountId: string, i: { kind: string; summary: string; followUpOn?: string; opportunityId?: string }) {
  need(c, 'crm:manage');
  if (!['call', 'meeting', 'email', 'sms', 'visit', 'note'].includes(i.kind)) throw new UserError('Choose the type of contact.');
  if (i.summary.trim().length < 2) throw new UserError('Write a short summary.');
  if (!dateOk(i.followUpOn)) throw new UserError('Enter a valid follow-up date.');
  if (!(await c.q.query('select 1 from crm_accounts where id = $1', [accountId]))[0]) throw new UserError('Account not found.');
  await c.q.query('insert into crm_activities (org_id, account_id, opportunity_id, kind, summary, follow_up_on, by_user) values ($1,$2,$3,$4,$5,$6,$7)', [c.orgId, accountId, i.opportunityId || null, i.kind, i.summary.trim(), i.followUpOn || null, c.userId]);
}

export async function completeFollowUp(c: Ctx, activityId: string) {
  need(c, 'crm:manage');
  await c.q.query('update crm_activities set follow_up_done = true where id = $1', [activityId]);
}

export async function createOpportunity(c: Ctx, accountId: string, i: { title: string; value: string; expectedClose?: string; campaignStart?: string; campaignEnd?: string }) {
  need(c, 'crm:manage');
  if (i.title.trim().length < 3) throw new UserError('Give the opportunity a title.');
  if (![i.expectedClose, i.campaignStart, i.campaignEnd].every(dateOk)) throw new UserError('Enter valid dates.');
  if (i.campaignStart && i.campaignEnd && i.campaignEnd < i.campaignStart) throw new UserError('The campaign cannot end before it starts.');
  if (!(await c.q.query('select 1 from crm_accounts where id = $1', [accountId]))[0]) throw new UserError('Account not found.');
  const r = await c.q.query<{ id: string }>('insert into crm_opportunities (org_id, account_id, title, value, expected_close, campaign_start, campaign_end, owner_user_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$8) returning id',
    [c.orgId, accountId, i.title.trim(), toDb(i.value.trim() ? money(i.value) : 0), i.expectedClose || null, i.campaignStart || null, i.campaignEnd || null, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'crm.opportunity_created', entity: 'crm_opportunity', entityId: r[0].id, after: { title: i.title, value: i.value }, ip: c.ip, userAgent: c.userAgent });
}

/** Moving an opportunity forward; winning one promotes the account to a client and creates the matching finance client. */
export async function moveOpportunity(c: Ctx, id: string, stage: string, lostReason?: string) {
  need(c, 'crm:manage');
  if (!(STAGES as readonly string[]).includes(stage)) throw new UserError('Unknown stage.');
  const o = (await c.q.query<any>('select * from crm_opportunities where id = $1 for update', [id]))[0];
  if (!o) throw new UserError('Opportunity not found.');
  if (['won', 'lost'].includes(o.stage)) throw new UserError('This opportunity is already closed.');
  if (stage === 'lost' && (lostReason ?? '').trim().length < 3) throw new UserError('Record why it was lost. It helps the next pitch.');
  await c.q.query(`update crm_opportunities set stage = $2, lost_reason = $3, closed_at = case when $2 in ('won','lost') then now() else null end where id = $1`, [id, stage, lostReason?.trim() || null]);
  let note = '';
  if (stage === 'won') {
    const a = (await c.q.query<any>('select * from crm_accounts where id = $1', [o.account_id]))[0];
    let party = a.fin_party_id as string | null;
    if (!party) {
      const ex = (await c.q.query<{ id: string }>(`select id from fin_parties where kind = 'client' and lower(name) = lower($1)`, [a.name]))[0];
      party = ex?.id ?? (await c.q.query<{ id: string }>(`insert into fin_parties (org_id, kind, name, phone, email) values ($1,'client',$2,$3,$4) returning id`, [c.orgId, a.name, a.phone, a.email]))[0].id;
    }
    await c.q.query(`update crm_accounts set status = 'client', fin_party_id = $2 where id = $1`, [a.id, party]);
    note = ' The account is now a client and is available in Finance for invoicing and receipts.';
  }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'crm.opportunity_moved', entity: 'crm_opportunity', entityId: id, before: { stage: o.stage }, after: { stage }, reason: lostReason, ip: c.ip, userAgent: c.userAgent });
  return `Moved to ${STAGE_LABEL[stage]}.${note}`;
}

export async function pipeline(c: Ctx) {
  need(c, 'crm:view');
  const rows = await c.q.query<any>(`select o.id, o.title, o.stage, o.value, o.expected_close::text as ec, a.id as account_id, a.name as account from crm_opportunities o join crm_accounts a on a.id = o.account_id where o.stage not in ('won','lost') or o.closed_at > now() - interval '30 days' order by o.value desc`);
  const cols = STAGES.map((s) => { const items = rows.filter((r) => r.stage === s).map((r) => ({ ...r, valueMinor: fromDb(r.value) })); return { stage: s, label: STAGE_LABEL[s], items, total: items.reduce((a, r) => a + r.valueMinor, 0) }; });
  const won = cols.find((x) => x.stage === 'won')!.total, lost = cols.find((x) => x.stage === 'lost')!.total;
  return { cols, winRate: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null, openValue: cols.filter((x) => !['won', 'lost'].includes(x.stage)).reduce((a, x) => a + x.total, 0) };
}

export async function followUpsDue(c: Ctx, withinDays = 0) {
  if (!c.subject.grants.some((g) => g.permissions.includes('crm:view') || g.permissions.includes('*'))) return [];
  return c.q.query<any>(`select x.id, x.summary, x.follow_up_on::text as due, a.id as account_id, a.name as account from crm_activities x join crm_accounts a on a.id = x.account_id
    where x.follow_up_on is not null and not x.follow_up_done and x.follow_up_on <= current_date + $1::int order by x.follow_up_on limit 20`, [withinDays]);
}

/** Daily nudge: tell the activity owner about follow-ups due today or overdue (deduplicated). */
export async function remindFollowUps(q: Q, orgId: string): Promise<number> {
  const rows = await q.query<any>(`select x.id, x.by_user, x.summary, a.name from crm_activities x join crm_accounts a on a.id = x.account_id where x.follow_up_on <= current_date and not x.follow_up_done`);
  let n = 0;
  for (const r of rows) {
    const x = await q.query(`insert into notifications (org_id, user_id, title, body, href, dedupe_key) values ($1,$2,$3,$4,$5,$6) on conflict do nothing returning id`, [orgId, r.by_user, `Follow-up due: ${r.name}`, r.summary, '/crm', `crm:${r.id}:${new Date().toISOString().slice(0, 10)}`]);
    if (x[0]) n++;
  }
  void notify;
  return n;
}
