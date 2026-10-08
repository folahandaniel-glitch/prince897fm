import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';

/**
 * Administrator oversight of what staff create on the front end: tasks, documents, support tickets, CRM accounts and opportunities,
 * calendar events, announcements and records in custom modules. Private channels (internal mail, payslips, discipline) are deliberately not
 * listed here. Every removal needs a reason and is written to the audit trail.
 */
export const KINDS = ['task', 'document', 'ticket', 'client', 'opportunity', 'event', 'announcement', 'record'] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABEL: Record<Kind, string> = { task: 'Task', document: 'Document', ticket: 'Ticket', client: 'Client', opportunity: 'Opportunity', event: 'Event', announcement: 'Announcement', record: 'Module record' };

export interface Item { kind: Kind; id: string; title: string; status: string | null; by: string | null; byName: string | null; at: string; href: string; removable: boolean }

export async function recentActivity(c: Ctx, f: { kind?: string; userId?: string; q?: string; days?: number; limit?: number } = {}): Promise<Item[]> {
  need(c, 'admin:control');
  const days = Math.min(Math.max(f.days ?? 30, 1), 365);
  const limit = Math.min(Math.max(f.limit ?? 80, 1), 200);
  const rows = await c.q.query<any>(`
    with feed as (
      select 'task'::text as kind, t.id::text as id, t.title, t.status, t.created_by as by, t.created_at as at, '/tasks/' || t.id as href from tasks t
      union all select 'document', d.id::text, d.title, case when d.archived_at is null then 'active' else 'archived' end, d.created_by, d.created_at, '/documents/' || d.id from documents d where d.archived_at is null
      union all select 'ticket', k.id::text, k.number || ' ' || k.subject, k.status, k.requester_user_id, k.created_at, '/tickets/' || k.id from tickets k
      union all select 'client', a.id::text, a.name, a.status, a.created_by, a.created_at, '/crm/' || a.id from crm_accounts a
      union all select 'opportunity', o.id::text, o.title, o.stage, o.owner_user_id, o.created_at, '/crm/' || o.account_id from crm_opportunities o
      union all select 'event', ev.id::text, ev.title, ev.kind, ev.created_by, ev.created_at, '/calendar' from events ev
      union all select 'announcement', an.id::text, an.title, null, an.created_by, an.created_at, '/announcements' from announcements an
      union all select 'record', r.id::text, r.number, r.status, r.created_by, r.created_at, '/m/' || ce.key || '/' || r.id from custom_records r join custom_entities ce on ce.id = r.entity_id where r.archived_at is null
    )
    select f.*, coalesce(e.full_name, u.email) as by_name from feed f left join users u on u.id = f.by left join employees e on e.user_id = f.by
     where f.at > now() - ($1 || ' days')::interval
       and ($2::text is null or f.kind = $2) and ($3::uuid is null or f.by = $3)
       and ($4::text is null or lower(f.title) like $4)
     order by f.at desc limit $5`,
    [String(days), f.kind && (KINDS as readonly string[]).includes(f.kind) ? f.kind : null, f.userId || null, f.q?.trim() ? `%${f.q.trim().toLowerCase().replace(/[%_\\]/g, (m) => '\\' + m)}%` : null, limit]);
  return rows.map((r) => ({ kind: r.kind, id: r.id, title: r.title, status: r.status, by: r.by, byName: r.by_name, at: new Date(r.at).toISOString(), href: r.href, removable: ['task', 'document', 'ticket', 'client', 'event', 'announcement'].includes(r.kind) }));
}

/** Counts of what each account has created, for the "who is doing what" overview. */
export async function accountSummary(c: Ctx) {
  need(c, 'admin:control');
  return c.q.query<any>(`select u.id, u.email, u.status, coalesce(e.full_name, u.email) as name,
      (select count(*)::int from tasks t where t.created_by = u.id) as tasks,
      (select count(*)::int from documents d where d.created_by = u.id and d.archived_at is null) as documents,
      (select count(*)::int from tickets k where k.requester_user_id = u.id) as tickets,
      (select count(*)::int from crm_accounts a where a.created_by = u.id) as clients,
      (select count(*)::int from announcements an where an.created_by = u.id) as announcements,
      (select count(*)::int from custom_records r where r.created_by = u.id and r.archived_at is null) as records
    from users u left join employees e on e.user_id = u.id where not u.hidden order by name`);
}

/** Take something staff created out of circulation (never deleted outright, except announcements and events, which are removed). */
export async function moderate(c: Ctx, kind: string, id: string, reason: string) {
  need(c, 'admin:control');
  if (reason.trim().length < 5) throw new UserError('Give a short reason (at least 5 characters). It is recorded in the audit trail.');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new UserError('Unknown item.');
  let r: unknown[];
  switch (kind) {
    case 'task': r = await c.q.query(`update tasks set status = 'cancelled', updated_at = now() where id = $1 and status <> 'cancelled' returning id`, [id]); break;
    case 'document': r = await c.q.query('update documents set archived_at = now() where id = $1 and archived_at is null returning id', [id]); break;
    case 'ticket': r = await c.q.query(`update tickets set status = 'closed' where id = $1 and status <> 'closed' returning id`, [id]); break;
    case 'client': r = await c.q.query(`update crm_accounts set status = 'inactive' where id = $1 and status <> 'inactive' returning id`, [id]); break;
    case 'event': r = await c.q.query('delete from events where id = $1 returning id', [id]); break;
    case 'announcement': r = await c.q.query('delete from announcements where id = $1 returning id', [id]); break;
    default: throw new UserError('This kind of item cannot be removed from here.');
  }
  if (!r[0]) throw new UserError('That item was already removed or changed.');
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: `oversight.${kind}_removed`, entity: kind, entityId: id, reason: reason.trim(), ip: c.ip, userAgent: c.userAgent });
}
