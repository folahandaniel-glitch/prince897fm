import { can } from '../domain/policy';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import type { Q } from './db';
import { notify } from './hr';

const PRIORITY_FACTOR: Record<string, number> = { urgent: 0.25, high: 0.5, normal: 1, low: 2 };
export const slaDue = (from: Date, slaHours: number, priority: string) => new Date(from.getTime() + slaHours * PRIORITY_FACTOR[priority] * 3_600_000);
export const STATUS_LABEL: Record<string, string> = { open: 'Open', in_progress: 'In progress', waiting: 'Waiting on requester', resolved: 'Resolved', closed: 'Closed' };

export const DEFAULT_CATEGORIES: [string, number][] = [['IT & equipment', 24], ['Studio / engineering fault', 4], ['HR request', 72], ['Finance query', 48], ['Facilities', 48], ['Advertiser / client enquiry', 24], ['Other', 72]];
export async function seedTicketCategories(q: Q, orgId: string) {
  for (const [name, h] of DEFAULT_CATEGORIES) await q.query('insert into ticket_categories (org_id, name, sla_hours) values ($1,$2,$3) on conflict do nothing', [orgId, name, h]);
}
export const listCategories = (q: Q) => q.query<any>('select id, name, sla_hours from ticket_categories where active order by name');

async function nextNumber(q: Q, orgId: string) {
  await q.query('select pg_advisory_xact_lock(hashtext($1))', [`tkt:${orgId}`]);
  const r = await q.query<{ n: number }>(`select coalesce(max(substring(number from '[0-9]+$')::int), 0) + 1 as n from tickets`);
  return `TKT-${String(r[0].n).padStart(5, '0')}`;
}

export async function createTicket(c: Ctx, i: { subject: string; description: string; categoryId?: string; priority?: string; accountId?: string; forName?: string; forEmail?: string }) {
  need(c, 'ticket:create');
  if (i.subject.trim().length < 3) throw new UserError('Give the ticket a short subject.');
  if (i.description.trim().length < 10) throw new UserError('Describe the problem in a sentence or two so it can be solved quickly.');
  const priority = i.priority || 'normal';
  if (!(priority in PRIORITY_FACTOR)) throw new UserError('Unknown priority.');
  if ((i.accountId || i.forName) && !can(c.subject, 'ticket:handle').allow) throw new UserError('Only support staff can log a ticket for a client.');
  const cat = i.categoryId ? (await c.q.query<any>('select id, sla_hours from ticket_categories where id = $1 and active', [i.categoryId]))[0] : null;
  if (i.categoryId && !cat) throw new UserError('Unknown category.');
  if (i.accountId && !(await c.q.query('select 1 from crm_accounts where id = $1', [i.accountId]))[0]) throw new UserError('Unknown account.');
  const number = await nextNumber(c.q, c.orgId);
  const now = new Date();
  const r = await c.q.query<{ id: string }>(
    `insert into tickets (org_id, number, subject, description, category_id, priority, requester_user_id, requester_name, requester_email, account_id, source, sla_due_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [c.orgId, number, i.subject.trim(), i.description.trim(), cat?.id ?? null, priority, i.forName ? null : c.userId, i.forName?.trim() || null, i.forEmail?.trim() || null, i.accountId || null, i.accountId ? 'crm' : 'staff', cat ? slaDue(now, cat.sla_hours, priority) : slaDue(now, 72, priority)]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'ticket.created', entity: 'ticket', entityId: r[0].id, after: { number, priority }, ip: c.ip, userAgent: c.userAgent });
  const handlers = await c.q.query<{ user_id: string }>(`select distinct ur.user_id from user_roles ur join roles r on r.id = ur.role_id where r.permissions && array['ticket:handle','ticket:manage','*'] and r.key <> 'super_admin' limit 10`);
  for (const h of handlers) if (h.user_id !== c.userId) await notify(c.q, c.orgId, h.user_id, `New ${priority} ticket`, `${number}: ${i.subject.trim()}`, `/tickets/${r[0].id}`);
  return { id: r[0].id, number };
}

const BASE = `select t.id, t.number, t.subject, t.status, t.priority, t.sla_due_at, t.created_at, t.requester_user_id, t.assignee_user_id, t.account_id, c.name as category, ru.email as requester, au.email as assignee, a.name as account,
  (t.sla_due_at < now() and t.status in ('open','in_progress','waiting')) as breached
  from tickets t left join ticket_categories c on c.id = t.category_id left join users ru on ru.id = t.requester_user_id left join users au on au.id = t.assignee_user_id left join crm_accounts a on a.id = t.account_id`;

export async function listTickets(c: Ctx, scope: 'mine' | 'all' | 'assigned', status?: string) {
  const handler = can(c.subject, 'ticket:handle').allow;
  if (scope === 'all' && !handler) need(c, 'ticket:handle');
  const where: string[] = []; const p: unknown[] = [];
  if (scope === 'mine') { p.push(c.userId); where.push(`t.requester_user_id = $${p.length}`); }
  if (scope === 'assigned') { p.push(c.userId); where.push(`t.assignee_user_id = $${p.length}`); }
  if (status === 'open') where.push(`t.status in ('open','in_progress','waiting')`);
  else if (status && status in STATUS_LABEL) { p.push(status); where.push(`t.status = $${p.length}`); }
  return c.q.query<any>(`${BASE} ${where.length ? 'where ' + where.join(' and ') : ''} order by (t.status in ('resolved','closed')), t.sla_due_at nulls last limit 200`, p);
}

export async function getTicket(c: Ctx, id: string) {
  const t = (await c.q.query<any>(`${BASE.replace('select t.id,', 'select t.*, t.id,')} where t.id = $1`, [id]))[0];
  if (!t) return null;
  const handler = can(c.subject, 'ticket:handle').allow;
  if (!handler && t.requester_user_id !== c.userId) need(c, 'ticket:handle');
  const comments = await c.q.query<any>(`select tc.id, tc.body, tc.internal, tc.created_at, coalesce(u.email, tc.author_name) as author from ticket_comments tc left join users u on u.id = tc.user_id where tc.ticket_id = $1 ${handler ? '' : 'and not tc.internal'} order by tc.id`, [id]);
  const handlers = handler ? await c.q.query<any>(`select distinct u.id, u.email from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where (r.permissions && array['ticket:handle','ticket:manage']) and not u.hidden order by u.email`) : [];
  return { t, comments, handler, handlers, isRequester: t.requester_user_id === c.userId };
}

export async function comment(c: Ctx, id: string, body: string, internal = false) {
  const d = await getTicket(c, id);
  if (!d) throw new UserError('Ticket not found.');
  if (!body.trim()) throw new UserError('Write a message first.');
  if (internal && !d.handler) throw new UserError('Only support staff can add internal notes.');
  if (['closed'].includes(d.t.status)) throw new UserError('This ticket is closed. Open a new one if the problem returns.');
  await c.q.query('insert into ticket_comments (org_id, ticket_id, user_id, body, internal) values ($1,$2,$3,$4,$5)', [c.orgId, id, c.userId, body.trim(), internal]);
  if (d.handler && !internal && !d.t.first_response_at) await c.q.query('update tickets set first_response_at = now() where id = $1', [id]);
  if (d.isRequester && d.t.status === 'waiting') await c.q.query(`update tickets set status = 'open' where id = $1`, [id]);
  const other = d.isRequester ? d.t.assignee_user_id : d.t.requester_user_id;
  if (other && !internal && other !== c.userId) await notify(c.q, c.orgId, other, `New reply on ${d.t.number}`, d.t.subject, `/tickets/${id}`);
}

export async function setStatus(c: Ctx, id: string, status: string, assigneeId?: string | null) {
  need(c, 'ticket:handle');
  if (!(status in STATUS_LABEL)) throw new UserError('Unknown status.');
  const t = (await c.q.query<any>('select * from tickets where id = $1 for update', [id]))[0];
  if (!t) throw new UserError('Ticket not found.');
  if (assigneeId && !(await c.q.query('select 1 from users where id = $1 and status = $2', [assigneeId, 'active']))[0]) throw new UserError('Unknown assignee.');
  await c.q.query(`update tickets set status = $2, assignee_user_id = coalesce($3, assignee_user_id), resolved_at = case when $2 in ('resolved','closed') then coalesce(resolved_at, now()) else null end where id = $1`, [id, status, assigneeId || null]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'ticket.status_changed', entity: 'ticket', entityId: id, before: { status: t.status, assignee: t.assignee_user_id }, after: { status, assignee: assigneeId ?? t.assignee_user_id }, ip: c.ip, userAgent: c.userAgent });
  if (t.requester_user_id && t.requester_user_id !== c.userId && status !== t.status) await notify(c.q, c.orgId, t.requester_user_id, `${t.number} is now ${STATUS_LABEL[status]}`, t.subject, `/tickets/${id}`);
}

export async function rate(c: Ctx, id: string, score: number) {
  const t = (await c.q.query<any>('select * from tickets where id = $1', [id]))[0];
  if (!t || t.requester_user_id !== c.userId) throw new UserError('Ticket not found.');
  if (!['resolved', 'closed'].includes(t.status)) throw new UserError('You can rate a ticket once it is resolved.');
  if (!(score >= 1 && score <= 5)) throw new UserError('Choose 1 to 5.');
  await c.q.query('update tickets set satisfaction = $2 where id = $1', [id, score]);
}

/** Tickets past their SLA are escalated once: handlers and the Head of HR/Executive are told. */
export async function escalateOverdue(q: Q, orgId: string): Promise<number> {
  const rows = await q.query<any>(`select id, number, subject from tickets where status in ('open','in_progress','waiting') and sla_due_at < now() and escalated_at is null`);
  if (rows.length === 0) return 0;
  const people = await q.query<{ user_id: string }>(`select distinct ur.user_id from user_roles ur join roles r on r.id = ur.role_id where (r.permissions && array['ticket:manage']) and r.key <> 'super_admin' limit 10`);
  for (const t of rows) {
    await q.query('update tickets set escalated_at = now() where id = $1', [t.id]);
    for (const p of people) await notify(q, orgId, p.user_id, `SLA breached: ${t.number}`, t.subject, `/tickets/${t.id}`);
  }
  return rows.length;
}

export async function ticketStats(c: Ctx) {
  need(c, 'ticket:handle');
  const [s] = await c.q.query<any>(`select count(*) filter (where status in ('open','in_progress','waiting'))::int open, count(*) filter (where sla_due_at < now() and status in ('open','in_progress','waiting'))::int breached,
    count(*) filter (where status in ('resolved','closed') and resolved_at > now() - interval '30 days')::int solved30, round(avg(satisfaction)::numeric, 1) csat from tickets`);
  return s;
}
