import crypto from 'node:crypto';
import { can } from '../domain/policy';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import { notify } from './hr';

export type Folder = 'inbox' | 'sent' | 'archive' | 'trash';

/** Directory of people one can write to (hidden accounts are filtered out by the database). */
export async function directory(c: Ctx) {
  need(c, 'mail:use');
  return c.q.query<any>(`select u.id, coalesce(e.full_name, u.email) as name, u.email from users u left join employees e on e.user_id = u.id where u.status = 'active' and u.id <> $1 order by name`, [c.userId]);
}

export async function send(c: Ctx, i: { to: string[]; cc?: string[]; subject: string; body: string; priority?: string; threadId?: string }) {
  need(c, 'mail:use');
  const to = [...new Set(i.to)].filter(Boolean), cc = [...new Set(i.cc ?? [])].filter((x) => x && !to.includes(x));
  if (to.length === 0) throw new UserError('Choose at least one recipient.');
  if (to.length + cc.length > 50) throw new UserError('You can write to at most 50 people at once.');
  if (i.subject.trim().length < 1) throw new UserError('Add a subject.');
  if (i.body.trim().length < 1) throw new UserError('Write a message.');
  const all = [...to, ...cc];
  const valid = await c.q.query<{ id: string }>(`select id from users where id = any($1::uuid[]) and status = 'active'`, [all]);
  if (valid.length !== all.length) throw new UserError('One of the recipients does not exist.');
  let thread = i.threadId;
  if (thread) {
    const ok = await c.q.query('select 1 from mail_messages m where m.thread_id = $1 and (m.sender_user_id = $2 or exists (select 1 from mail_recipients r where r.message_id = m.id and r.user_id = $2)) limit 1', [thread, c.userId]);
    if (!ok[0]) throw new UserError('You can only reply to conversations you are part of.');
  } else thread = crypto.randomUUID();
  const m = await c.q.query<{ id: string }>('insert into mail_messages (org_id, thread_id, subject, body, priority, sender_user_id) values ($1,$2,$3,$4,$5,$6) returning id', [c.orgId, thread, i.subject.trim().slice(0, 200), i.body.trim(), i.priority === 'high' ? 'high' : 'normal', c.userId]);
  for (const u of to) await c.q.query('insert into mail_recipients (org_id, message_id, user_id, kind) values ($1,$2,$3,$4)', [c.orgId, m[0].id, u, 'to']);
  for (const u of cc) await c.q.query('insert into mail_recipients (org_id, message_id, user_id, kind) values ($1,$2,$3,$4)', [c.orgId, m[0].id, u, 'cc']);
  for (const u of all) await notify(c.q, c.orgId, u, `New message: ${i.subject.trim().slice(0, 80)}`, undefined, `/mail/${thread}`);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'mail.sent', entity: 'mail_message', entityId: m[0].id, after: { recipients: all.length } });
  return thread;
}

export async function listMail(c: Ctx, folder: Folder) {
  need(c, 'mail:use');
  if (folder === 'sent') {
    return c.q.query<any>(`select distinct on (m.thread_id) m.thread_id, m.subject, m.created_at, m.priority, true as read,
        (select string_agg(coalesce(e.full_name, u.email), ', ') from mail_recipients r join users u on u.id = r.user_id left join employees e on e.user_id = u.id where r.message_id = m.id) as party
       from mail_messages m where m.sender_user_id = $1 order by m.thread_id, m.created_at desc`, [c.userId])
      .then((r) => r.sort((a: any, b: any) => +new Date(b.created_at) - +new Date(a.created_at)).slice(0, 100));
  }
  return c.q.query<any>(
    `select * from (select distinct on (m.thread_id) m.thread_id, m.subject, m.created_at, m.priority, (r.read_at is not null) as read, coalesce(e.full_name, u.email) as party
       from mail_recipients r join mail_messages m on m.id = r.message_id join users u on u.id = m.sender_user_id left join employees e on e.user_id = u.id
      where r.user_id = $1 and r.folder = $2 order by m.thread_id, m.created_at desc) x order by created_at desc limit 100`, [c.userId, folder]);
}

export async function getThread(c: Ctx, threadId: string) {
  need(c, 'mail:use');
  const msgs = await c.q.query<any>(
    `select m.id, m.subject, m.body, m.priority, m.created_at, m.sender_user_id, coalesce(e.full_name, u.email) as sender,
            (select string_agg(coalesce(e2.full_name, u2.email), ', ') from mail_recipients r2 join users u2 on u2.id = r2.user_id left join employees e2 on e2.user_id = u2.id where r2.message_id = m.id and r2.kind = 'to') as to_names
       from mail_messages m join users u on u.id = m.sender_user_id left join employees e on e.user_id = u.id
      where m.thread_id = $1 and (m.sender_user_id = $2 or exists (select 1 from mail_recipients r where r.message_id = m.id and r.user_id = $2)) order by m.created_at`, [threadId, c.userId]);
  if (msgs.length === 0) return null;
  await c.q.query('update mail_recipients set read_at = now() where user_id = $1 and read_at is null and message_id = any($2::uuid[])', [c.userId, msgs.map((m) => m.id)]);
  const parties = await c.q.query<any>(`select distinct u.id, coalesce(e.full_name, u.email) as name from mail_recipients r join users u on u.id = r.user_id left join employees e on e.user_id = u.id where r.message_id = any($1::uuid[]) union select u.id, coalesce(e.full_name, u.email) from users u left join employees e on e.user_id = u.id where u.id = any($2::uuid[])`, [msgs.map((m) => m.id), msgs.map((m) => m.sender_user_id)]);
  return { msgs, parties: parties.filter((p) => p.id !== c.userId) };
}

export async function move(c: Ctx, threadId: string, folder: 'inbox' | 'archive' | 'trash') {
  need(c, 'mail:use');
  await c.q.query('update mail_recipients set folder = $3 where user_id = $1 and message_id in (select id from mail_messages where thread_id = $2)', [c.userId, threadId, folder]);
}

export async function unreadCount(c: Ctx) {
  if (!can(c.subject, 'mail:use').allow) return 0;
  return (await c.q.query<{ n: number }>(`select count(*)::int n from mail_recipients where user_id = $1 and read_at is null and folder = 'inbox'`, [c.userId]))[0].n;
}
