import {
  allowedNext, canTransition, fillTemplate, hasAccess, matches, slug as mkSlug, validateBlocks, validateEntity, validateRecord,
  type Access, type Block, type Condition, type EntityDef, type FieldDef,
} from '../domain/builders';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import { privileged, withTenant, type Q } from './db';
import { notify } from './hr';

// ---- Access helpers ------------------------------------------------------------------------------------------------------------------------
const today = () => new Date().toISOString().slice(0, 10);
export function roleKeys(c: Ctx): string[] {
  const d = today();
  return c.subject.grants.filter((g) => g.validFrom <= d && (!g.validTo || g.validTo >= d)).map((g) => g.roleKey);
}
const isSuper = (c: Ctx) => c.subject.grants.some((g) => g.permissions.includes('*'));
const allowed = (c: Ctx, list: string[]) => isSuper(c) || hasAccess(list, roleKeys(c));

// ---- Navigation extras (cached): modules, dashboards and pages show up in the menu automatically -----------------------------------------
export interface NavExtras { entities: { key: string; plural: string; group: string; view: string[] }[]; dashboards: { slug: string; name: string; roles: string[] }[]; pages: { slug: string; title: string; roles: string[] }[] }
const navCache = new Map<string, { at: number; v: NavExtras }>();
export const invalidateNav = (orgId: string) => navCache.delete(orgId);
export async function navExtras(q: Q, orgId: string): Promise<NavExtras> {
  const hit = navCache.get(orgId);
  if (hit && Date.now() - hit.at < 15_000) return hit.v;
  const [e, d, p] = await Promise.all([
    q.query<any>('select key, plural, nav_group, access from custom_entities where active order by plural'),
    q.query<any>('select slug, name, roles from dashboards where active order by name'),
    q.query<any>('select slug, title, roles from custom_pages where published order by title'),
  ]);
  const v: NavExtras = { entities: e.map((x) => ({ key: x.key, plural: x.plural, group: x.nav_group, view: x.access.view })), dashboards: d.map((x) => ({ slug: x.slug, name: x.name, roles: x.roles })), pages: p.map((x) => ({ slug: x.slug, title: x.title, roles: x.roles })) };
  navCache.set(orgId, { at: Date.now(), v });
  return v;
}

// ---- Entities ------------------------------------------------------------------------------------------------------------------------------------
const mapEntity = (r: any): EntityDef & { id: string; version: number; active: boolean; navGroup: string; publicSlug: string | null; publicNotifyRole: string | null } => ({
  id: r.id, key: r.key, name: r.name, plural: r.plural, description: r.description ?? undefined, prefix: r.prefix, fields: r.fields, statuses: r.statuses, transitions: r.transitions, access: r.access,
  version: r.version, active: r.active, navGroup: r.nav_group, publicSlug: r.public_slug, publicNotifyRole: r.public_notify_role,
});
export type Entity = ReturnType<typeof mapEntity>;

export async function listEntities(q: Q) {
  return (await q.query<any>('select * from custom_entities order by active desc, name')).map(mapEntity);
}
export async function getEntity(q: Q, key: string): Promise<Entity | null> {
  const r = (await q.query<any>('select * from custom_entities where key = $1', [key]))[0];
  return r ? mapEntity(r) : null;
}

async function rolesSet(q: Q) { return new Set((await q.query<{ key: string }>('select key from roles')).map((r) => r.key)); }

export interface EntityInput { key: string; name: string; plural: string; description?: string; prefix: string; fields: FieldDef[]; statuses: { key: string; label: string }[]; transitions: { from: string; to: string; roles: string[] }[]; access: Access; navGroup?: string; publicSlug?: string | null; publicNotifyRole?: string | null }

export async function saveEntity(c: Ctx, i: EntityInput) {
  need(c, 'builder:manage');
  const existing = await getEntity(c.q, i.key);
  // Fields are never deleted: dropping one from the definition archives it, so existing records keep their data.
  const fields = [...i.fields];
  if (existing) for (const old of existing.fields) if (!fields.some((f) => f.key === old.key)) fields.push({ ...old, archived: true, required: false });
  const def: EntityDef = { key: i.key, name: i.name.trim(), plural: i.plural.trim() || i.name.trim(), description: i.description, prefix: i.prefix, fields, statuses: i.statuses, transitions: i.transitions, access: i.access };
  const errs = validateEntity(def, await rolesSet(c.q));
  const pub = i.publicSlug ? mkSlug(i.publicSlug, 40).replace(/_/g, '-') : null;
  if (pub && fields.some((f) => !f.archived && ['employee', 'department'].includes(f.type))) errs.push('A public form cannot include employee or department fields.');
  if (errs.length) throw new UserError(errs[0]);
  if (existing) {
    await c.q.query(`update custom_entities set name=$2, plural=$3, description=$4, fields=$5::jsonb, statuses=$6::jsonb, transitions=$7::jsonb, access=$8::jsonb, nav_group=$9, public_slug=$10, public_notify_role=$11, version=version+1, updated_at=now() where id=$1`,
      [existing.id, def.name, def.plural, def.description ?? null, JSON.stringify(fields), JSON.stringify(def.statuses), JSON.stringify(def.transitions), JSON.stringify(def.access), i.navGroup || 'Modules', pub, i.publicNotifyRole || null]);
  } else {
    if ((await c.q.query('select 1 from custom_entities where prefix = $1', [def.prefix]))[0]) throw new UserError(`The prefix ${def.prefix} is already used by another module.`);
    await c.q.query(`insert into custom_entities (org_id, key, name, plural, description, prefix, fields, statuses, transitions, access, nav_group, public_slug, public_notify_role, created_by) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14)`,
      [c.orgId, def.key, def.name, def.plural, def.description ?? null, def.prefix, JSON.stringify(fields), JSON.stringify(def.statuses), JSON.stringify(def.transitions), JSON.stringify(def.access), i.navGroup || 'Modules', pub, i.publicNotifyRole || null, c.userId]);
  }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: existing ? 'builder.entity_updated' : 'builder.entity_created', entity: 'custom_entity', entityId: def.key, before: existing ? { version: existing.version, fields: existing.fields.length } : null, after: { fields: fields.length, statuses: def.statuses.length, public: !!pub }, ip: c.ip, userAgent: c.userAgent });
  invalidateNav(c.orgId);
}

export async function setEntityActive(c: Ctx, key: string, active: boolean) {
  need(c, 'builder:manage');
  await c.q.query('update custom_entities set active = $2, updated_at = now() where key = $1', [key, active]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: active ? 'builder.entity_enabled' : 'builder.entity_disabled', entity: 'custom_entity', entityId: key, ip: c.ip, userAgent: c.userAgent });
  invalidateNav(c.orgId);
}

// ---- Records -----------------------------------------------------------------------------------------------------------------------------------
const searchText = (e: Entity, data: Record<string, unknown>, number: string) =>
  [number, ...e.fields.filter((f) => !f.archived && ['text', 'longtext', 'select', 'email', 'phone', 'number'].includes(f.type)).map((f) => data[f.key] ?? '')].join(' ').toLowerCase().slice(0, 4000);

async function nextNumber(q: Q, e: Entity) {
  await q.query('select pg_advisory_xact_lock(hashtext($1))', [`rec:${e.id}`]);
  const r = await q.query<{ n: number }>(`select coalesce(max(substring(number from '[0-9]+$')::int), 0) + 1 as n from custom_records where entity_id = $1`, [e.id]);
  return `${e.prefix}-${String(r[0].n).padStart(5, '0')}`;
}

async function checkRefs(q: Q, e: Entity, data: Record<string, unknown>) {
  for (const f of e.fields.filter((x) => !x.archived && data[x.key] !== undefined)) {
    if (f.type === 'employee' && !(await q.query('select 1 from employees where id = $1', [data[f.key]]))[0]) throw new UserError(`${f.label}: unknown employee.`);
    if (f.type === 'department' && !(await q.query('select 1 from departments where id = $1', [data[f.key]]))[0]) throw new UserError(`${f.label}: unknown department.`);
  }
}

export interface FieldErrors extends Error { fields?: Record<string, string> }

export async function createRecord(c: Ctx, key: string, input: Record<string, unknown>) {
  const e = await getEntity(c.q, key);
  if (!e || !e.active) throw new UserError('This module does not exist.');
  if (!allowed(c, e.access.create)) need(c, `entity:${key}:create`); // falls through to a Forbidden error
  const v = validateRecord(e.fields, input);
  if (!v.ok) throw Object.assign(new UserError(Object.values(v.errors)[0]), { fields: v.errors });
  await checkRefs(c.q, e, v.data);
  const number = await nextNumber(c.q, e);
  const status = e.statuses[0].key;
  const r = await c.q.query<{ id: string }>('insert into custom_records (org_id, entity_id, number, data, status, search, created_by) values ($1,$2,$3,$4::jsonb,$5,$6,$7) returning id', [c.orgId, e.id, number, JSON.stringify(v.data), status, searchText(e, v.data, number), c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'record.created', entity: `module:${key}`, entityId: r[0].id, after: { number, status }, ip: c.ip, userAgent: c.userAgent });
  await runAutomations(c.q, c.orgId, e, 'record_created', { number, data: v.data, status, creatorId: c.userId, recordId: r[0].id });
  return { id: r[0].id, number };
}

export async function updateRecord(c: Ctx, key: string, id: string, input: Record<string, unknown>) {
  const e = await getEntity(c.q, key);
  if (!e) throw new UserError('This module does not exist.');
  if (!allowed(c, e.access.edit)) need(c, `entity:${key}:edit`);
  const rec = (await c.q.query<any>('select * from custom_records where id = $1 and entity_id = $2 for update', [id, e.id]))[0];
  if (!rec || rec.archived_at) throw new UserError('Record not found.');
  const v = validateRecord(e.fields, input);
  if (!v.ok) throw Object.assign(new UserError(Object.values(v.errors)[0]), { fields: v.errors });
  await checkRefs(c.q, e, v.data);
  await c.q.query('update custom_records set data = $2::jsonb, search = $3, updated_at = now() where id = $1', [id, JSON.stringify(v.data), searchText(e, v.data, rec.number)]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'record.updated', entity: `module:${key}`, entityId: id, before: rec.data, after: v.data, ip: c.ip, userAgent: c.userAgent });
}

export async function transitionRecord(c: Ctx, key: string, id: string, to: string, note: string) {
  const e = await getEntity(c.q, key);
  if (!e) throw new UserError('This module does not exist.');
  const rec = (await c.q.query<any>('select * from custom_records where id = $1 and entity_id = $2 for update', [id, e.id]))[0];
  if (!rec || rec.archived_at) throw new UserError('Record not found.');
  if (!allowed(c, e.access.view)) need(c, `entity:${key}:view`);
  const check = isSuper(c) && e.transitions.some((t) => t.from === rec.status && t.to === to) ? { ok: true as const } : canTransition(e, rec.status, to, roleKeys(c));
  if (!check.ok) throw new UserError(check.reason);
  await c.q.query('update custom_records set status = $2, updated_at = now() where id = $1', [id, to]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'record.status_changed', entity: `module:${key}`, entityId: id, before: { status: rec.status }, after: { status: to }, reason: note || undefined, ip: c.ip, userAgent: c.userAgent });
  await runAutomations(c.q, c.orgId, e, 'status_changed', { number: rec.number, data: rec.data, status: to, creatorId: rec.created_by, recordId: id });
}

export async function archiveRecord(c: Ctx, key: string, id: string, reason: string) {
  const e = await getEntity(c.q, key);
  if (!e) throw new UserError('This module does not exist.');
  if (!allowed(c, e.access.remove)) need(c, `entity:${key}:remove`);
  if (reason.trim().length < 5) throw new UserError('Give a reason.');
  await c.q.query('update custom_records set archived_at = now() where id = $1 and entity_id = $2', [id, e.id]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'record.archived', entity: `module:${key}`, entityId: id, reason, ip: c.ip, userAgent: c.userAgent });
}

export async function listRecords(c: Ctx, key: string, f: { q?: string; status?: string } = {}) {
  const e = await getEntity(c.q, key);
  if (!e || !e.active) return null;
  if (!allowed(c, e.access.view)) need(c, `entity:${key}:view`);
  const where = ['r.entity_id = $1', 'r.archived_at is null']; const p: unknown[] = [e.id];
  if (f.status) { p.push(f.status); where.push(`r.status = $${p.length}`); }
  if (f.q) { p.push(`%${f.q.toLowerCase()}%`); where.push(`r.search like $${p.length}`); }
  const rows = await c.q.query<any>(`select r.id, r.number, r.data, r.status, r.created_at, u.email as creator from custom_records r left join users u on u.id = r.created_by where ${where.join(' and ')} order by r.created_at desc limit 200`, p);
  return { entity: e, rows, canCreate: allowed(c, e.access.create), canEdit: allowed(c, e.access.edit) };
}

export async function getRecord(c: Ctx, key: string, id: string) {
  const e = await getEntity(c.q, key);
  if (!e || !e.active) return null;
  if (!allowed(c, e.access.view)) need(c, `entity:${key}:view`);
  const r = (await c.q.query<any>('select r.*, u.email as creator from custom_records r left join users u on u.id = r.created_by where r.id = $1 and r.entity_id = $2 and r.archived_at is null', [id, e.id]))[0];
  if (!r) return null;
  const history = await c.q.query<any>(`select a.action, a.created_at, a.reason, a.before, a.after, u.email as actor from audit_events a left join users u on u.id = a.actor_user_id where a.entity = $1 and a.entity_id = $2 order by a.id desc limit 30`, [`module:${key}`, id]);
  const next = isSuper(c) ? e.transitions.filter((t) => t.from === r.status).map((t) => t.to) : allowedNext(e, r.status, roleKeys(c));
  return { entity: e, rec: r, history, next, canEdit: allowed(c, e.access.edit), canRemove: allowed(c, e.access.remove) };
}

export async function recordsCsv(c: Ctx, key: string) {
  const d = await listRecords(c, key);
  if (!d) throw new UserError('Module not found.');
  need(c, 'builder:manage'); // exports of module data are an administrator action
  const esc = (v: unknown) => { let s = Array.isArray(v) ? v.join('; ') : String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  const cols = d.entity.fields.filter((f) => !f.archived);
  const out = [['Number', 'Status', 'Created', ...cols.map((f) => f.label)].map(esc).join(',')];
  for (const r of d.rows) out.push([r.number, r.status, new Date(r.created_at).toISOString(), ...cols.map((f) => r.data[f.key])].map(esc).join(','));
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'builder.records_exported', entity: `module:${key}`, after: { rows: d.rows.length }, ip: c.ip, userAgent: c.userAgent });
  return out.join('\r\n');
}

// ---- Automations ------------------------------------------------------------------------------------------------------------------------------------
export interface ActionDef { type: 'notify_role' | 'notify_creator' | 'create_task'; role?: string; message?: string; title?: string }

export async function saveAutomation(c: Ctx, i: { entityKey: string; name: string; trigger: string; conditions: Condition[]; actions: ActionDef[] }) {
  need(c, 'builder:manage');
  const e = await getEntity(c.q, i.entityKey);
  if (!e) throw new UserError('Unknown module.');
  if (i.name.trim().length < 3) throw new UserError('Name the rule.');
  if (!['record_created', 'status_changed'].includes(i.trigger)) throw new UserError('Choose when this rule runs.');
  if (i.actions.length === 0) throw new UserError('Add at least one action.');
  const roles = await rolesSet(c.q);
  const fieldKeys = new Set(['_status', ...e.fields.map((f) => f.key)]);
  for (const cd of i.conditions) if (!fieldKeys.has(cd.field)) throw new UserError(`Unknown field "${cd.field}" in the conditions.`);
  for (const a of i.actions) { if (a.type === 'notify_role' && !roles.has(a.role ?? '')) throw new UserError('Choose a valid role to notify.'); if (a.type === 'create_task' && (a.title ?? '').trim().length < 3) throw new UserError('Give the task a title.'); }
  const r = await c.q.query<{ id: string }>('insert into automation_rules (org_id, entity_id, name, trigger, conditions, actions) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb) returning id', [c.orgId, e.id, i.name.trim(), i.trigger, JSON.stringify(i.conditions), JSON.stringify(i.actions)]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'builder.automation_created', entity: 'automation_rule', entityId: r[0].id, after: i, ip: c.ip, userAgent: c.userAgent });
}
export async function listAutomations(q: Q) {
  return q.query<any>('select a.id, a.name, a.trigger, a.conditions, a.actions, a.active, e.name as entity, e.key from automation_rules a join custom_entities e on e.id = a.entity_id order by a.created_at desc');
}
export async function toggleAutomation(c: Ctx, id: string, active: boolean) {
  need(c, 'builder:manage');
  await c.q.query('update automation_rules set active = $2 where id = $1', [id, active]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'builder.automation_toggled', entity: 'automation_rule', entityId: id, after: { active }, ip: c.ip, userAgent: c.userAgent });
}

async function runAutomations(q: Q, orgId: string, e: Entity, trigger: 'record_created' | 'status_changed', ctx: { number: string; data: Record<string, unknown>; status: string; creatorId: string | null; recordId: string }) {
  const rules = await q.query<any>('select * from automation_rules where entity_id = $1 and trigger = $2 and active', [e.id, trigger]);
  for (const r of rules) {
    if (!matches(r.conditions as Condition[], ctx.data, ctx.status)) continue;
    for (const a of r.actions as ActionDef[]) {
      const msg = fillTemplate(a.message || `${e.name} ${ctx.number}`, ctx.data, { number: ctx.number, status: ctx.status, module: e.name });
      if (a.type === 'notify_role') {
        const users = await q.query<{ user_id: string }>(`select distinct ur.user_id from user_roles ur join roles r on r.id = ur.role_id where r.key = $1 and ur.valid_from <= current_date and (ur.valid_to is null or ur.valid_to >= current_date) limit 20`, [a.role]);
        for (const u of users) await notify(q, orgId, u.user_id, `${e.name}: ${r.name}`, msg, `/m/${e.key}/${ctx.recordId}`);
      } else if (a.type === 'notify_creator' && ctx.creatorId) await notify(q, orgId, ctx.creatorId, `${e.name}: ${r.name}`, msg, `/m/${e.key}/${ctx.recordId}`);
      else if (a.type === 'create_task' && ctx.creatorId) {
        const emp = (await q.query<{ id: string }>('select id from employees where user_id = $1', [ctx.creatorId]))[0];
        await q.query(`insert into tasks (org_id, title, description, assignee_employee_id, created_by) values ($1,$2,$3,$4,$5)`, [orgId, fillTemplate(a.title ?? msg, ctx.data, { number: ctx.number }).slice(0, 200), `Created by automation "${r.name}" for ${ctx.number}`, emp?.id ?? null, ctx.creatorId]);
      }
    }
  }
}

// ---- Public forms ------------------------------------------------------------------------------------------------------------------------------------
export async function publicFormDefinition(orgSlug: string, formSlug: string) {
  const org = (await (await privileged()).query<any>(`select id, name from organizations where slug = $1 and status = 'active'`, [orgSlug.toLowerCase()]))[0];
  if (!org) return null;
  const e = await withTenant(org.id, (q) => q.query<any>('select * from custom_entities where public_slug = $1 and active', [formSlug]));
  return e[0] ? { org, entity: mapEntity(e[0]) } : null;
}

/** Anonymous submission: honeypot, per-IP rate limit, strict validation. Stored without any user; the notified role triages it. */
export async function submitPublicForm(orgSlug: string, formSlug: string, input: Record<string, unknown>, ip: string | null) {
  const def = await publicFormDefinition(orgSlug, formSlug);
  if (!def) throw new UserError('This form is not available.');
  if (String(input.website ?? '').trim() !== '') return { number: 'OK' }; // honeypot: bots fill hidden fields; pretend success
  const e = def.entity;
  const v = validateRecord(e.fields.filter((f) => !['employee', 'department'].includes(f.type)), input);
  if (!v.ok) throw Object.assign(new UserError(Object.values(v.errors)[0]), { fields: v.errors });
  return withTenant(def.org.id, async (q) => {
    if (ip) {
      const n = (await q.query<{ c: number }>(`select count(*)::int c from custom_records where source_ip = $1 and created_at > now() - interval '10 minutes'`, [ip]))[0].c;
      if (n >= 5) throw new UserError('Too many submissions from your network. Please try again in a few minutes.');
    }
    const number = await nextNumber(q, e);
    const r = await q.query<{ id: string }>('insert into custom_records (org_id, entity_id, number, data, status, search, source_ip) values ($1,$2,$3,$4::jsonb,$5,$6,$7) returning id', [def.org.id, e.id, number, JSON.stringify(v.data), e.statuses[0].key, searchText(e, v.data, number), ip]);
    await audit(q, { orgId: def.org.id, action: 'record.submitted_public', entity: `module:${e.key}`, entityId: r[0].id, after: { number }, ip });
    if (e.publicNotifyRole) {
      const users = await q.query<{ user_id: string }>(`select distinct ur.user_id from user_roles ur join roles r on r.id = ur.role_id where r.key = $1 limit 20`, [e.publicNotifyRole]);
      for (const u of users) await notify(q, def.org.id, u.user_id, `New ${e.name} submission`, number, `/m/${e.key}/${r[0].id}`);
    }
    await runAutomations(q, def.org.id, e, 'record_created', { number, data: v.data, status: e.statuses[0].key, creatorId: null, recordId: r[0].id });
    return { number };
  });
}

// ---- Pages ---------------------------------------------------------------------------------------------------------------------------------------------
export async function listPages(q: Q) { return q.query<any>('select id, slug, title, published, version, updated_at from custom_pages order by title'); }

export async function savePage(c: Ctx, i: { slug: string; title: string; blocks: Block[]; roles: string[]; publish: boolean }) {
  need(c, 'builder:manage');
  const s = mkSlug(i.slug, 60).replace(/_/g, '-');
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(s)) throw new UserError('Choose a short web address for the page (letters, numbers, dashes).');
  if (i.title.trim().length < 2) throw new UserError('Give the page a title.');
  const errs = validateBlocks(i.blocks);
  if (errs.length) throw new UserError(errs[0]);
  const ex = (await c.q.query<any>('select * from custom_pages where slug = $1', [s]))[0];
  let id: string, version = 1;
  if (ex) { version = ex.version + 1; id = ex.id; await c.q.query('update custom_pages set title=$2, blocks=$3::jsonb, roles=$4::jsonb, published=$5, version=$6, updated_by=$7, updated_at=now() where id=$1', [id, i.title.trim(), JSON.stringify(i.blocks), JSON.stringify(i.roles.length ? i.roles : ['*']), i.publish, version, c.userId]); }
  else id = (await c.q.query<{ id: string }>('insert into custom_pages (org_id, slug, title, blocks, roles, published, updated_by) values ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7) returning id', [c.orgId, s, i.title.trim(), JSON.stringify(i.blocks), JSON.stringify(i.roles.length ? i.roles : ['*']), i.publish, c.userId]))[0].id;
  await c.q.query('insert into custom_page_versions (org_id, page_id, version, title, blocks, saved_by) values ($1,$2,$3,$4,$5::jsonb,$6)', [c.orgId, id, version, i.title.trim(), JSON.stringify(i.blocks), c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'builder.page_saved', entity: 'custom_page', entityId: s, after: { version, published: i.publish }, ip: c.ip, userAgent: c.userAgent });
  invalidateNav(c.orgId);
  return s;
}

export async function getPageForView(c: Ctx, slugIn: string) {
  const p = (await c.q.query<any>('select * from custom_pages where slug = $1', [slugIn]))[0];
  if (!p) return null;
  const canEdit = c.subject.grants.some((g) => g.permissions.includes('builder:manage') || g.permissions.includes('*'));
  if (!p.published && !canEdit) return null;
  if (!allowed(c, p.roles)) return null;
  return { ...p, canEdit };
}
export async function pageVersions(c: Ctx, slugIn: string) {
  need(c, 'builder:manage');
  return c.q.query<any>(`select v.version, v.title, v.created_at, u.email as saved_by from custom_page_versions v join custom_pages p on p.id = v.page_id left join users u on u.id = v.saved_by where p.slug = $1 order by v.version desc limit 20`, [slugIn]);
}
