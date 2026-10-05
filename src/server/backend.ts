import { ALL_PERMISSIONS, SYSTEM_ROLES } from '../domain/policy';
import { DEFAULT_BRANDING, DEFAULT_TERMS } from '../domain/config-schema';
import { MODULE_PACKS, ORG_TEMPLATES } from '../domain/templates';
import { audit } from './audit';
import { hashPassword, oneTimePassword } from './auth';
import { invalidateConfig } from './config';
import { need, UserError, type Ctx } from './ctx';
import { privileged, withTenant } from './db';
import { saveEntity, getEntity, invalidateNav } from './builders';
import { seedFinanceDefaults } from './finance';
import { seedRules } from './discipline';
import { seedTicketCategories } from './tickets';
import { createSuperAdmin } from './seed';

const CUR = `a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)`;
const emailOk = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

// ---- Users and roles -----------------------------------------------------------------------------------------------------------------------------
export async function listUsers(c: Ctx) {
  need(c, 'backend:access');
  return c.q.query<any>(
    `select u.id, u.email, u.status, u.must_change_password, u.mfa_enabled, u.hidden, e.full_name, e.employee_no, d.name as department,
            (select coalesce(json_agg(r.name order by r.name), '[]'::json) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id) as roles,
            (select coalesce(json_agg(r.key), '[]'::json) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id) as role_keys
       from users u left join employees e on e.user_id = u.id left join assignments a on a.employee_id = e.id and ${CUR} left join departments d on d.id = a.department_id order by u.email`);
}

export async function listRoles(c: Ctx) {
  need(c, 'backend:access');
  return c.q.query<any>(`select r.id, r.key, r.name, r.permissions, r.is_system, r.hidden, (select count(*)::int from user_roles ur where ur.role_id = r.id) as members from roles r order by r.hidden desc, r.name`);
}

export async function createUser(c: Ctx, i: { email: string; fullName: string; roleKey: string; departmentId?: string | null; positionId?: string | null }) {
  need(c, 'backend:access');
  const email = i.email.trim().toLowerCase();
  if (!emailOk(email)) throw new UserError('Enter a valid email address.');
  if (i.fullName.trim().length < 2) throw new UserError('Enter the full name.');
  if (i.roleKey === 'super_admin') throw new UserError('The Super Administrator role cannot be granted from here.');
  const role = (await c.q.query<any>('select id from roles where key = $1', [i.roleKey]))[0];
  if (!role) throw new UserError('Choose a role.');
  if ((await c.q.query('select 1 from users where email = $1', [email]))[0]) throw new UserError('That email already has an account.');
  const pw = oneTimePassword();
  const u = (await c.q.query<{ id: string }>('insert into users (org_id, email, password_hash, must_change_password) values ($1,$2,$3,true) returning id', [c.orgId, email, hashPassword(pw)]))[0].id;
  await c.q.query('insert into user_roles (org_id, user_id, role_id, granted_by) values ($1,$2,$3,$4)', [c.orgId, u, role.id, c.userId]);
  const [{ n }] = await c.q.query<{ n: number }>(`select coalesce(max(substring(employee_no from '[0-9]+$')::int), 0) + 1 as n from employees where employee_no like 'EMP-%'`);
  const emp = (await c.q.query<{ id: string }>('insert into employees (org_id, user_id, employee_no, full_name, email) values ($1,$2,$3,$4,$5) returning id', [c.orgId, u, `EMP-${String(n).padStart(4, '0')}`, i.fullName.trim(), email]))[0].id;
  await c.q.query(`insert into assignments (org_id, employee_id, department_id, position_id, valid_from, reason, approved_by) values ($1,$2,$3,$4,current_date,'Created by administrator',$5)`, [c.orgId, emp, i.departmentId || null, i.positionId || null, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'backend.user_created', entity: 'user', entityId: u, after: { email, role: i.roleKey }, ip: c.ip, userAgent: c.userAgent });
  return { id: u, password: pw };
}

export async function resetPassword(c: Ctx, userId: string) {
  need(c, 'backend:access');
  const u = (await c.q.query<any>('select id, email, hidden from users where id = $1', [userId]))[0];
  if (!u) throw new UserError('User not found.');
  if (u.id === c.userId) throw new UserError('Use "Change password" on your own account page.');
  const pw = oneTimePassword();
  await c.q.query('update users set password_hash = $2, must_change_password = true where id = $1', [userId, hashPassword(pw)]);
  await c.q.query('delete from sessions where user_id = $1', [userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'backend.password_reset', entity: 'user', entityId: userId, ip: c.ip, userAgent: c.userAgent });
  return pw;
}

export async function setUserStatus(c: Ctx, userId: string, active: boolean, reason: string) {
  need(c, 'backend:access');
  if (userId === c.userId) throw new UserError('You cannot disable your own account.');
  if (!active && reason.trim().length < 5) throw new UserError('Give a reason.');
  const u = (await c.q.query('select id from users where id = $1', [userId]))[0];
  if (!u) throw new UserError('User not found.');
  await c.q.query('update users set status = $2 where id = $1', [userId, active ? 'active' : 'disabled']);
  if (!active) await c.q.query('delete from sessions where user_id = $1', [userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: active ? 'backend.user_enabled' : 'backend.user_disabled', entity: 'user', entityId: userId, reason, ip: c.ip, userAgent: c.userAgent });
}

export async function setUserRoles(c: Ctx, userId: string, roleKeys: string[]) {
  need(c, 'backend:access');
  if (roleKeys.length === 0) throw new UserError('A user needs at least one role.');
  if (roleKeys.includes('super_admin')) throw new UserError('The Super Administrator role cannot be granted from here.');
  const u = (await c.q.query<any>('select id, hidden from users where id = $1', [userId]))[0];
  if (!u) throw new UserError('User not found.');
  if (u.hidden) throw new UserError('This account\'s roles are fixed.');
  const roles = await c.q.query<{ id: string; key: string }>('select id, key from roles where key = any($1::text[])', [roleKeys]);
  if (roles.length !== roleKeys.length) throw new UserError('Unknown role.');
  const before = await c.q.query<{ key: string }>('select r.key from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1', [userId]);
  await c.q.query('delete from user_roles where user_id = $1', [userId]);
  for (const r of roles) await c.q.query('insert into user_roles (org_id, user_id, role_id, granted_by) values ($1,$2,$3,$4)', [c.orgId, userId, r.id, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'backend.roles_changed', entity: 'user', entityId: userId, before: { roles: before.map((b) => b.key) }, after: { roles: roleKeys }, ip: c.ip, userAgent: c.userAgent });
}

export async function saveRole(c: Ctx, i: { key: string; name: string; permissions: string[] }) {
  need(c, 'backend:access');
  if (!/^[a-z][a-z0-9_]{2,29}$/.test(i.key)) throw new UserError('Role key: 3-30 lowercase letters, numbers or underscores.');
  if (i.name.trim().length < 3) throw new UserError('Name the role.');
  const bad = i.permissions.filter((p) => !ALL_PERMISSIONS.includes(p));
  if (bad.length) throw new UserError(`Unknown permission: ${bad[0]}`);
  if (i.permissions.includes('backend:access')) throw new UserError('The backend permission is reserved for the Super Administrator.');
  const ex = (await c.q.query<any>('select id, permissions, is_system, hidden from roles where key = $1', [i.key]))[0];
  if (ex?.hidden) throw new UserError('This role cannot be edited.');
  if (ex) await c.q.query('update roles set name = $2, permissions = $3 where id = $1', [ex.id, i.name.trim(), i.permissions]);
  else await c.q.query('insert into roles (org_id, key, name, permissions) values ($1,$2,$3,$4)', [c.orgId, i.key, i.name.trim(), i.permissions]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: ex ? 'backend.role_updated' : 'backend.role_created', entity: 'role', entityId: i.key, before: ex ? { permissions: ex.permissions } : null, after: { permissions: i.permissions }, ip: c.ip, userAgent: c.userAgent });
}

// ---- Feature flags -------------------------------------------------------------------------------------------------------------------------------
export const FEATURES: { key: string; label: string; note: string }[] = [
  { key: 'attendance', label: 'Attendance, rosters and leave', note: 'Clock in/out, shifts, workplaces, leave.' },
  { key: 'reports', label: 'Reports', note: 'Weekly and monthly reporting with approvals.' },
  { key: 'tasks', label: 'Tasks and projects', note: '' },
  { key: 'finance', label: 'Finance', note: 'Ledger, approvals, budgets.' },
  { key: 'payroll', label: 'Payroll and payslips', note: 'Salaries, statutory deductions, fines.' },
  { key: 'discipline', label: 'Warnings and queries', note: 'Disciplinary cases and rule library.' },
  { key: 'crm', label: 'CRM', note: 'Leads, clients, opportunities.' },
  { key: 'tickets', label: 'Support tickets', note: 'Helpdesk with SLAs.' },
  { key: 'documents', label: 'Documents', note: 'Library with expiry alerts.' },
  { key: 'mail', label: 'Internal mail', note: '' },
  { key: 'calendar', label: 'Calendar and events', note: '' },
  { key: 'training', label: 'Training and certification', note: 'Courses, records, expiry alerts.' },
  { key: 'builders', label: 'Builders and custom modules', note: 'Modules, forms, dashboards, pages.' },
];

export async function listFeatures(c: Ctx) {
  need(c, 'backend:access');
  const off = new Set((await c.q.query<{ key: string }>('select key from org_features where not enabled')).map((r) => r.key));
  return FEATURES.map((f) => ({ ...f, enabled: !off.has(f.key) }));
}
export async function setFeature(c: Ctx, key: string, enabled: boolean) {
  need(c, 'backend:access');
  if (!FEATURES.some((f) => f.key === key)) throw new UserError('Unknown module.');
  await c.q.query('insert into org_features (org_id, key, enabled, updated_by) values ($1,$2,$3,$4) on conflict (org_id, key) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()', [c.orgId, key, enabled, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'backend.feature_toggled', entity: 'feature', entityId: key, after: { enabled }, ip: c.ip, userAgent: c.userAgent });
}

// ---- Security ---------------------------------------------------------------------------------------------------------------------------------------
export async function securityOverview(c: Ctx, orgSlug: string) {
  need(c, 'backend:access');
  const attempts = await c.q.query<any>('select key, success, created_at from recent_login_attempts($1)', [orgSlug]);
  const sessions = await c.q.query<any>(`select s.id, u.email, s.ip, s.user_agent, s.created_at, s.idle_expires_at from sessions s join users u on u.id = s.user_id where not s.mfa_pending and s.expires_at > now() order by s.created_at desc limit 50`);
  const noMfa = await c.q.query<any>(`select u.email, string_agg(r.name, ', ') as roles from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where u.status = 'active' and not u.mfa_enabled and (r.permissions && array['finance:approve','finance:pay','payroll:approve','payroll:manage','role:manage','dashboard:executive','*']) group by u.email order by u.email`);
  return { attempts, sessions, noMfa };
}
export async function killSession(c: Ctx, id: string) {
  need(c, 'backend:access');
  await c.q.query('delete from sessions where id = $1', [id]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'backend.session_revoked', entity: 'session', entityId: id, ip: c.ip, userAgent: c.userAgent });
}

// ---- Assisting the Chairman ----------------------------------------------------------------------------------------------------------------------
/** What is waiting on the Chairman's (executive) approval across modules, so the Super Admin can help clear it. */
export async function chairmanQueue(c: Ctx) {
  need(c, 'backend:access');
  const [fin, rep, pay, disc, notes] = await Promise.all([
    c.q.query<any>(`select id, number, title, amount from fin_transactions where status = 'reviewed' and approval_steps ->> approval_index = 'executive' order by created_at`),
    c.q.query<any>(`select r.id, t.name, e.full_name from reports r join report_templates t on t.id = r.template_id join employees e on e.id = r.employee_id where r.status in ('submitted','under_review') and r.chain_snapshot -> r.step ->> 'roleKey' = 'executive'`),
    c.q.query<any>(`select id, period from pay_runs where status = 'draft' order by period`),
    c.q.query<any>(`select d.id, d.number, d.title from discipline_cases d where d.kind = 'query' and d.status = 'responded'`),
    c.q.query<any>(`select count(*)::int c from notifications n join user_roles ur on ur.user_id = n.user_id join roles r on r.id = ur.role_id where r.key = 'executive' and n.read_at is null and not exists (select 1 from users u where u.id = n.user_id and u.hidden)`),
  ]);
  return { fin, rep, pay, disc, unreadForChairman: notes[0].c };
}

// ---- Module packs and organisation templates ------------------------------------------------------------------------------------------------------
export async function installPack(c: Ctx, packKey: string) {
  need(c, 'builder:manage');
  const p = MODULE_PACKS.find((x) => x.key === packKey);
  if (!p) throw new UserError('Unknown module pack.');
  if (await getEntity(c.q, p.key)) throw new UserError('This module is already installed.');
  await saveEntity(c, { key: p.key, name: p.name, plural: p.plural, description: p.description, prefix: p.prefix, fields: p.fields, statuses: p.statuses, transitions: p.transitions, access: p.access, publicSlug: p.publicForm?.slug ?? null, publicNotifyRole: p.publicForm?.notifyRole ?? null });
}

export interface ProvisionInput { slug: string; name: string; templateKey: string; adminEmail: string; adminName?: string; superAdminEmail?: string }

/** Create a whole new organisation from a template (platform operators only). Returns one-time passwords to hand over securely. */
export async function provisionOrganization(actor: { orgId: string; userId: string; ip?: string | null }, i: ProvisionInput) {
  // Authorise in its own short transaction; the long provisioning work below must not run inside the caller's transaction.
  const { runAs } = await import('./ctx');
  await runAs(actor.orgId, actor.userId, async (c) => need(c, 'backend:access'));
  const me = (await (await privileged()).query<any>('select platform_admin from users where id = $1', [actor.userId]))[0];
  if (!me?.platform_admin) throw new UserError('Only platform operators can create organisations.');
  const r = await createOrganization(i, actor.userId);
  await runAs(actor.orgId, actor.userId, (c) => audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'backend.organization_created', entity: 'organization', entityId: r.orgId, after: { slug: r.slug }, ip: actor.ip }));
  return r;
}

/** Creates an organisation from a template. No authorisation here: callers (BackEnd action, provisioning script) must authorise first. */
export async function createOrganization(i: ProvisionInput, byUserId: string | null) {
  const { runAs } = await import('./ctx');
  const slug = i.slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) throw new UserError('The organisation code can use lowercase letters, numbers and dashes.');
  if (i.name.trim().length < 2) throw new UserError('Enter the organisation name.');
  if (!emailOk(i.adminEmail.trim())) throw new UserError('Enter the administrator\'s email.');
  const t = ORG_TEMPLATES.find((x) => x.key === i.templateKey);
  if (!t) throw new UserError('Choose a template.');
  const p = await privileged();
  if ((await p.query('select 1 from organizations where slug = $1', [slug]))[0]) throw new UserError('That organisation code is already taken.');
  const orgId = (await p.query<{ id: string }>('insert into organizations (slug, name, template) values ($1,$2,$3) returning id', [slug, i.name.trim(), t.key]))[0].id;
  const adminPw = oneTimePassword();
  await withTenant(orgId, async (q) => {
    const roleIds: Record<string, string> = {};
    for (const r of SYSTEM_ROLES) { if (r.hidden) continue; roleIds[r.key] = (await q.query<{ id: string }>('insert into roles (org_id, key, name, permissions, is_system) values ($1,$2,$3,$4,true) returning id', [orgId, r.key, r.name, r.permissions]))[0].id; }
    for (const [k, d] of t.departments.entries()) await q.query('insert into departments (org_id, name, sort_order) values ($1,$2,$3)', [orgId, d, k]);
    await q.query('insert into branches (org_id, name) values ($1,$2)', [orgId, t.branchName]);
    for (const [k, [n, rank]] of t.positions.entries()) await q.query('insert into positions (org_id, name, rank_level, sort_order) values ($1,$2,$3,$4)', [orgId, n, rank, k]);
    await q.query(`insert into config_versions (org_id, kind, version, status, payload, note, published_at) values ($1,'branding',1,'published',$2::jsonb,'Created from template', now())`, [orgId, JSON.stringify({ ...DEFAULT_BRANDING, name: i.name.trim(), shortName: i.name.trim().slice(0, 24), primary: t.primary, secondary: t.secondary, accent: t.accent })]);
    if (t.terms) await q.query(`insert into config_versions (org_id, kind, version, status, payload, note, published_at) values ($1,'terminology',1,'published',$2::jsonb,'Created from template', now())`, [orgId, JSON.stringify({ ...DEFAULT_TERMS, ...t.terms })]);
    await seedRules(q, orgId); await seedTicketCategories(q, orgId);
    for (const [n, days, paid] of [['Annual leave', 20, true], ['Sick leave', 12, true], ['Compassionate leave', 5, true], ['Study leave', 0, false]] as const) await q.query('insert into leave_types (org_id, name, annual_days, paid) values ($1,$2,$3,$4)', [orgId, n, days, paid]);
    const [{ id: userId }] = await q.query<{ id: string }>('insert into users (org_id, email, password_hash, must_change_password) values ($1,$2,$3,true) returning id', [orgId, i.adminEmail.trim().toLowerCase(), hashPassword(adminPw)]);
    await q.query('insert into user_roles (org_id, user_id, role_id) values ($1,$2,$3)', [orgId, userId, roleIds.tenant_admin]);
    await q.query(`insert into employees (org_id, user_id, employee_no, full_name, email) values ($1,$2,'EMP-0001',$3,$4)`, [orgId, userId, i.adminName?.trim() || 'Administrator', i.adminEmail.trim().toLowerCase()]);
    await seedFinanceDefaults(q, orgId, userId, 0);
    await audit(q, { orgId, actorUserId: userId, action: 'organization.provisioned', entity: 'organization', entityId: orgId, after: { template: t.key, by: byUserId } });
  });
  let superPw: string | null = null;
  if (i.superAdminEmail && emailOk(i.superAdminEmail.trim())) superPw = (await createSuperAdmin(orgId, i.superAdminEmail.trim(), null)).password;
  // install packs through a minimal admin context
  if (t.packs.length) {
    const adminId = (await p.query<{ id: string }>('select id from users where org_id = $1 and email = $2', [orgId, i.adminEmail.trim().toLowerCase()]))[0].id;
    const wanted = MODULE_PACKS.filter((m) => t.packs.includes(m.pack));
    await runAs(orgId, adminId, async (ac) => { for (const m of wanted) await saveEntity({ ...ac, subject: { ...ac.subject, grants: [{ roleKey: 'tenant_admin', permissions: ['builder:manage'], departmentIds: null, branchIds: null, validFrom: '2000-01-01', validTo: null }] } }, { key: m.key, name: m.name, plural: m.plural, description: m.description, prefix: m.prefix, fields: m.fields, statuses: m.statuses, transitions: m.transitions, access: m.access, publicSlug: m.publicForm?.slug ?? null, publicNotifyRole: m.publicForm?.notifyRole ?? null }); });
  }
  return { orgId, slug, adminPassword: adminPw, superAdminPassword: superPw };
}

// ---- Configuration export / import --------------------------------------------------------------------------------------------------------------
export async function exportConfig(c: Ctx) {
  need(c, 'backend:access');
  const q = c.q;
  const [departments, branches, positions, shifts, leaveTypes, ticketCategories, entities, dashboards, bands, rules, cfg, templates] = await Promise.all([
    q.query<any>('select name, code, sort_order from departments where archived_at is null order by sort_order'), q.query<any>('select name, code, region from branches where archived_at is null'), q.query<any>('select name, rank_level from positions where archived_at is null order by rank_level'),
    q.query<any>('select name, code, start_time::text as start_time, end_time::text as end_time, grace_minutes, early_window_minutes from shifts where archived_at is null'), q.query<any>('select name, annual_days, paid from leave_types where archived_at is null'),
    q.query<any>('select name, sla_hours from ticket_categories where active'), q.query<any>('select key, name, plural, description, prefix, fields, statuses, transitions, access, nav_group, public_slug from custom_entities where active'),
    q.query<any>('select slug, name, device, widgets, roles from dashboards where active'), q.query<any>('select min_amount::text as min_amount, steps from fin_approval_bands order by min_amount'),
    q.query<any>('select code, title, category, description, reference, guidance, default_action from discipline_rules where active'), q.query<any>(`select kind, payload from config_versions where status = 'published'`),
    q.query<any>('select name, cadence, due_weekday, due_time::text as due_time, fields, chain from report_templates where active'),
  ]);
  const bundle = { format: 'worksuite-config', version: 1, exportedAt: new Date().toISOString(), config: Object.fromEntries(cfg.map((r) => [r.kind, r.payload])), departments, branches, positions, shifts, leaveTypes, ticketCategories, entities, dashboards, approvalBands: bands, disciplineRules: rules, reportTemplates: templates };
  await audit(q, { orgId: c.orgId, actorUserId: c.userId, action: 'backend.config_exported', entity: 'organization', entityId: c.orgId, ip: c.ip, userAgent: c.userAgent });
  return bundle;
}

/** Additive import: creates what is missing (by name/key), never overwrites or deletes. Dry run reports what would change. */
export async function importConfig(c: Ctx, json: string, dryRun: boolean) {
  need(c, 'backend:access');
  let b: any;
  try { b = JSON.parse(json); } catch { throw new UserError('That file is not valid JSON.'); }
  if (b?.format !== 'worksuite-config' || b.version !== 1) throw new UserError('This is not a WorkSuite configuration export.');
  const out = { created: {} as Record<string, number>, skipped: {} as Record<string, number> };
  const bump = (k: string, made: boolean) => { (made ? out.created : out.skipped)[k] = ((made ? out.created : out.skipped)[k] ?? 0) + 1; };
  const q = c.q;
  for (const d of b.departments ?? []) { const ex = (await q.query('select 1 from departments where lower(name) = lower($1)', [d.name]))[0]; bump('departments', !ex); if (!ex && !dryRun) await q.query('insert into departments (org_id, name, code, sort_order) values ($1,$2,$3,$4)', [c.orgId, d.name, d.code ?? null, d.sort_order ?? 0]); }
  for (const d of b.branches ?? []) { const ex = (await q.query('select 1 from branches where lower(name) = lower($1)', [d.name]))[0]; bump('branches', !ex); if (!ex && !dryRun) await q.query('insert into branches (org_id, name, code, region) values ($1,$2,$3,$4)', [c.orgId, d.name, d.code ?? null, d.region ?? null]); }
  for (const d of b.positions ?? []) { const ex = (await q.query('select 1 from positions where lower(name) = lower($1)', [d.name]))[0]; bump('positions', !ex); if (!ex && !dryRun) await q.query('insert into positions (org_id, name, rank_level) values ($1,$2,$3)', [c.orgId, d.name, d.rank_level ?? 100]); }
  for (const d of b.shifts ?? []) { const ex = (await q.query('select 1 from shifts where code = $1', [d.code]))[0]; bump('shifts', !ex); if (!ex && !dryRun) await q.query('insert into shifts (org_id, name, code, start_time, end_time, grace_minutes, early_window_minutes) values ($1,$2,$3,$4,$5,$6,$7)', [c.orgId, d.name, d.code, d.start_time, d.end_time, d.grace_minutes ?? 10, d.early_window_minutes ?? 60]); }
  for (const d of b.leaveTypes ?? []) { const ex = (await q.query('select 1 from leave_types where lower(name) = lower($1)', [d.name]))[0]; bump('leaveTypes', !ex); if (!ex && !dryRun) await q.query('insert into leave_types (org_id, name, annual_days, paid) values ($1,$2,$3,$4)', [c.orgId, d.name, d.annual_days, d.paid]); }
  for (const d of b.ticketCategories ?? []) { const ex = (await q.query('select 1 from ticket_categories where name = $1', [d.name]))[0]; bump('ticketCategories', !ex); if (!ex && !dryRun) await q.query('insert into ticket_categories (org_id, name, sla_hours) values ($1,$2,$3)', [c.orgId, d.name, d.sla_hours]); }
  for (const d of b.disciplineRules ?? []) { const ex = (await q.query('select 1 from discipline_rules where code = $1', [d.code]))[0]; bump('disciplineRules', !ex); if (!ex && !dryRun) await q.query('insert into discipline_rules (org_id, code, title, category, description, reference, guidance, default_action) values ($1,$2,$3,$4,$5,$6,$7,$8)', [c.orgId, d.code, d.title, d.category, d.description, d.reference, d.guidance, d.default_action]); }
  for (const d of b.entities ?? []) {
    const ex = await getEntity(q, d.key); bump('entities', !ex);
    if (!ex && !dryRun) await saveEntity({ ...c, subject: { ...c.subject, grants: [{ roleKey: 'import', permissions: ['builder:manage'], departmentIds: null, branchIds: null, validFrom: '2000-01-01', validTo: null }] } }, { key: d.key, name: d.name, plural: d.plural, description: d.description, prefix: d.prefix, fields: d.fields, statuses: d.statuses, transitions: d.transitions, access: d.access, navGroup: d.nav_group, publicSlug: d.public_slug });
  }
  for (const d of b.dashboards ?? []) { const ex = (await q.query('select 1 from dashboards where slug = $1', [d.slug]))[0]; bump('dashboards', !ex); if (!ex && !dryRun) await q.query('insert into dashboards (org_id, slug, name, device, widgets, roles, created_by) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)', [c.orgId, d.slug, d.name, d.device, JSON.stringify(d.widgets), JSON.stringify(d.roles), c.userId]); }
  if (!dryRun) {
    await audit(q, { orgId: c.orgId, actorUserId: c.userId, action: 'backend.config_imported', entity: 'organization', entityId: c.orgId, after: out, ip: c.ip, userAgent: c.userAgent });
    invalidateNav(c.orgId); invalidateConfig(c.orgId);
  }
  return { ...out, dryRun };
}

export async function overview(c: Ctx) {
  need(c, 'backend:access');
  const [s] = await c.q.query<any>(`select (select count(*)::int from users where status = 'active') users, (select count(*)::int from users where status = 'disabled') disabled, (select count(*)::int from employees where not hidden and status = 'active') staff,
    (select count(*)::int from sessions where not mfa_pending and expires_at > now()) sessions, (select count(*)::int from audit_events where created_at > now() - interval '24 hours') audit24, (select count(*)::int from custom_entities where active) modules`);
  const migrations = await c.q.query<any>('select name, applied_at from schema_migrations order by name');
  return { ...s, migrations };
}
