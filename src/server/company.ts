import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import { notify } from './hr';
import { visibleTo } from './calendar';

// ---- Memos: formal notices that people must read and acknowledge --------------------------------------------------------------------------------
async function nextRef(c: Ctx) {
  await c.q.query('select pg_advisory_xact_lock(hashtext($1))', [`memo:${c.orgId}`]);
  const r = await c.q.query<{ n: number }>(`select coalesce(max(substring(ref from '[0-9]+$')::int), 0) + 1 as n from memos`);
  return `MEMO-${String(r[0].n).padStart(4, '0')}`;
}

export async function postMemo(c: Ctx, i: { title: string; body: string; roles?: string[]; requireAck?: boolean }) {
  need(c, 'memo:post');
  if (i.title.trim().length < 2) throw new UserError('Give the memo a title.');
  if (i.body.trim().length < 1) throw new UserError('Write the memo.');
  const ref = await nextRef(c);
  const roles = i.roles?.length ? i.roles : ['*'];
  const m = (await c.q.query<{ id: string }>('insert into memos (org_id, ref, title, body, roles, require_ack, created_by) values ($1,$2,$3,$4,$5::jsonb,$6,$7) returning id', [c.orgId, ref, i.title.trim(), i.body.trim(), JSON.stringify(roles), i.requireAck !== false, c.userId]))[0];
  const people = await c.q.query<{ id: string }>(`select u.id from users u where u.status = 'active' and not u.hidden and u.id <> $1`, [c.userId]);
  const rolesOf = async (uid: string) => (await c.q.query<{ key: string }>('select r.key from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1', [uid])).map((r) => r.key);
  for (const p of people) { if (roles.includes('*') || (await rolesOf(p.id)).some((k) => roles.includes(k))) await notify(c.q, c.orgId, p.id, `New memo: ${i.title.trim()}`, i.requireAck !== false ? 'Please read and acknowledge it.' : undefined, `/memos/${m.id}`); }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'memo.posted', entity: 'memo', entityId: m.id, after: { ref, title: i.title.trim() }, ip: c.ip, userAgent: c.userAgent });
  return { id: m.id, ref };
}

export async function listMemos(c: Ctx) {
  const rows = await c.q.query<any>(`select m.id, m.ref, m.title, m.body, m.roles, m.require_ack, m.created_at, coalesce(e.full_name, u.email) as author, (select acked_at from memo_acks a where a.memo_id = m.id and a.user_id = $1) as my_ack from memos m join users u on u.id = m.created_by left join employees e on e.user_id = u.id order by m.created_at desc limit 100`, [c.userId]);
  return rows.filter((m) => visibleTo(c, m.roles));
}

export async function getMemo(c: Ctx, id: string) {
  const m = (await c.q.query<any>(`select m.*, coalesce(e.full_name, u.email) as author, (select acked_at from memo_acks a where a.memo_id = m.id and a.user_id = $2) as my_ack from memos m join users u on u.id = m.created_by left join employees e on e.user_id = u.id where m.id = $1`, [id, c.userId]))[0];
  if (!m || !visibleTo(c, m.roles)) return null;
  return m;
}

export async function acknowledge(c: Ctx, id: string) {
  const m = await getMemo(c, id);
  if (!m) throw new UserError('Memo not found.');
  await c.q.query('insert into memo_acks (memo_id, user_id, org_id) values ($1,$2,$3) on conflict do nothing', [id, c.userId, c.orgId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'memo.acknowledged', entity: 'memo', entityId: id, ip: c.ip, userAgent: c.userAgent });
}

/** For the sender: who has acknowledged and who has not. */
export async function ackStatus(c: Ctx, id: string) {
  need(c, 'memo:post');
  const m = (await c.q.query<any>('select roles from memos where id = $1', [id]))[0];
  if (!m) throw new UserError('Memo not found.');
  const people = await c.q.query<any>(`select u.id, coalesce(e.full_name, u.email) as name, (select acked_at from memo_acks a where a.memo_id = $1 and a.user_id = u.id) as acked_at, (select coalesce(json_agg(r.key), '[]'::json) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id) as keys
    from users u left join employees e on e.user_id = u.id where u.status = 'active' and not u.hidden order by name`, [id]);
  const roles: string[] = m.roles;
  return people.filter((p) => roles.includes('*') || (p.keys as string[]).some((k) => roles.includes(k))).map((p) => ({ id: p.id as string, name: p.name as string, ackedAt: p.acked_at ? new Date(p.acked_at).toISOString() : null }));
}

export async function unreadMemoCount(c: Ctx): Promise<number> {
  const rows = await c.q.query<any>(`select m.roles from memos m where m.require_ack and not exists (select 1 from memo_acks a where a.memo_id = m.id and a.user_id = $1) and m.created_by <> $1 limit 50`, [c.userId]);
  return rows.filter((m) => visibleTo(c, m.roles)).length;
}

// ---- Knowledge base -----------------------------------------------------------------------------------------------------------------------------------------
export async function listArticles(c: Ctx, f: { q?: string; category?: string } = {}) {
  need(c, 'kb:view');
  const manage = c.subject.grants.some((g) => g.permissions.includes('kb:manage') || g.permissions.includes('*'));
  const where: string[] = []; const p: unknown[] = [];
  if (!manage) where.push(`a.status = 'published'`);
  if (f.category) { p.push(f.category); where.push(`a.category = $${p.length}`); }
  if (f.q?.trim()) { p.push(`%${f.q.trim().toLowerCase().replace(/[%_\\]/g, (m) => '\\' + m)}%`); where.push(`(lower(a.title) like $${p.length} or lower(a.body) like $${p.length})`); }
  return c.q.query<any>(`select a.id, a.title, a.category, a.pinned, a.status, a.updated_at, left(a.body, 180) as excerpt from kb_articles a ${where.length ? 'where ' + where.join(' and ') : ''} order by a.pinned desc, a.category, a.title limit 200`, p);
}

export async function getArticle(c: Ctx, id: string) {
  need(c, 'kb:view');
  const a = (await c.q.query<any>(`select a.*, coalesce(e.full_name, u.email) as author from kb_articles a left join users u on u.id = a.updated_by left join employees e on e.user_id = u.id where a.id = $1`, [id]))[0];
  if (!a) return null;
  if (a.status !== 'published') need(c, 'kb:manage');
  return a;
}

export async function saveArticle(c: Ctx, i: { id?: string; title: string; category: string; body: string; pinned?: boolean; status?: string }) {
  need(c, 'kb:manage');
  if (i.title.trim().length < 3) throw new UserError('Give the article a title.');
  if (i.body.trim().length < 1) throw new UserError('Write the article.');
  const status = i.status === 'draft' ? 'draft' : 'published';
  const category = i.category.trim() || 'General';
  let id = i.id;
  if (id) {
    const r = await c.q.query('update kb_articles set title=$2, category=$3, body=$4, pinned=$5, status=$6, updated_by=$7, updated_at=now() where id=$1 returning id', [id, i.title.trim(), category, i.body, !!i.pinned, status, c.userId]);
    if (!r[0]) throw new UserError('Article not found.');
  } else id = (await c.q.query<{ id: string }>('insert into kb_articles (org_id, title, category, body, pinned, status, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$7) returning id', [c.orgId, i.title.trim(), category, i.body, !!i.pinned, status, c.userId]))[0].id;
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: i.id ? 'kb.updated' : 'kb.created', entity: 'kb_article', entityId: id!, after: { title: i.title.trim(), status }, ip: c.ip, userAgent: c.userAgent });
  return id!;
}

export async function deleteArticle(c: Ctx, id: string) {
  need(c, 'kb:manage');
  const r = await c.q.query('delete from kb_articles where id = $1 returning id', [id]);
  if (!r[0]) throw new UserError('Article not found.');
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'kb.deleted', entity: 'kb_article', entityId: id, ip: c.ip, userAgent: c.userAgent });
}
