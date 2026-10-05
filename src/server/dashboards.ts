import crypto from 'node:crypto';
import { slug as mkSlug, hasAccess } from '../domain/builders';
import { fromDb, formatMoney } from '../domain/finance';
import { localParts } from '../domain/attendance';
import { can } from '../domain/policy';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import { privileged, withTenant, type Q } from './db';
import { getEntity, roleKeys } from './builders';

export interface Widget { id: string; type: 'metric' | 'entity_count' | 'entity_list' | 'text'; title: string; metric?: string; entity?: string; status?: string; text?: string; size?: 's' | 'm' | 'l' }
export interface MetricDef { key: string; label: string; perm: string | null; tvSafe: boolean; run: (q: Q, ctx: { tz: string; cur: string; loc: string }) => Promise<{ value: string; sub?: string }> }

const todayIn = (tz: string) => localParts(new Date(), tz).date;
const n = (v: unknown) => String(Number(v ?? 0));

/** Built-in metrics. Each declares the permission needed to see it and whether it may appear on an unattended TV wallboard. */
export const METRICS: MetricDef[] = [
  { key: 'staff_active', label: 'Active staff', perm: 'employee:view', tvSafe: true, run: async (q) => ({ value: n((await q.query<any>(`select count(*)::int c from employees where status = 'active'`))[0].c) }) },
  { key: 'present_today', label: 'Clocked in today', perm: 'attendance:view', tvSafe: true, run: async (q, x) => { const r = (await q.query<any>(`select count(distinct employee_id)::int c from attendance_sessions where work_date = $1::date`, [todayIn(x.tz)]))[0]; return { value: n(r.c) }; } },
  { key: 'late_today', label: 'Late today', perm: 'attendance:view', tvSafe: true, run: async (q, x) => ({ value: n((await q.query<any>(`select count(*)::int c from attendance_sessions where work_date = $1::date and late_minutes > 0`, [todayIn(x.tz)]))[0].c) }) },
  { key: 'tasks_overdue', label: 'Overdue tasks', perm: 'task:assign', tvSafe: true, run: async (q) => ({ value: n((await q.query<any>(`select count(*)::int c from tasks where due_date < current_date and status in ('todo','in_progress','blocked')`))[0].c) }) },
  { key: 'leave_pending', label: 'Leave awaiting approval', perm: 'leave:review', tvSafe: true, run: async (q) => ({ value: n((await q.query<any>(`select count(*)::int c from leave_requests where status = 'pending'`))[0].c) }) },
  { key: 'reports_pending', label: 'Reports awaiting review', perm: 'report:review', tvSafe: true, run: async (q) => ({ value: n((await q.query<any>(`select count(*)::int c from reports where status in ('submitted','under_review')`))[0].c) }) },
  { key: 'tickets_open', label: 'Open support tickets', perm: 'ticket:handle', tvSafe: true, run: async (q) => ({ value: n((await q.query<any>(`select count(*)::int c from tickets where status in ('open','in_progress','waiting')`))[0].c) }) },
  { key: 'tickets_breached', label: 'Tickets past SLA', perm: 'ticket:handle', tvSafe: true, run: async (q) => ({ value: n((await q.query<any>(`select count(*)::int c from tickets where sla_due_at < now() and status in ('open','in_progress','waiting')`))[0].c) }) },
  { key: 'crm_open_value', label: 'Open sales pipeline', perm: 'crm:view', tvSafe: false, run: async (q, x) => ({ value: formatMoney(fromDb((await q.query<any>(`select coalesce(sum(value),0) v from crm_opportunities where stage not in ('won','lost')`))[0].v), x.cur, x.loc) }) },
  { key: 'finance_cash', label: 'Cash and bank balance', perm: 'finance:oversee', tvSafe: false, run: async (q, x) => { const r = (await q.query<any>(`select coalesce(sum(l.debit - l.credit),0) v from fin_journal_lines l join fin_accounts a on a.id = l.account_id where a.is_cash and not a.restricted`))[0]; return { value: formatMoney(fromDb(r.v), x.cur, x.loc) }; } },
  { key: 'finance_pending', label: 'Payments awaiting action', perm: 'finance:oversee', tvSafe: false, run: async (q) => ({ value: n((await q.query<any>(`select count(*)::int c from fin_transactions where status in ('submitted','reviewed','approved')`))[0].c) }) },
];
export const METRIC_BY_KEY = new Map(METRICS.map((m) => [m.key, m]));

export interface WidgetResult { widget: Widget; value?: string; sub?: string; rows?: { title: string; sub?: string; href?: string }[]; hidden?: boolean }

async function evalWidget(c: Ctx | null, q: Q, w: Widget, ctx: { tz: string; cur: string; loc: string }, tv: boolean): Promise<WidgetResult> {
  if (w.type === 'text') return { widget: w, value: w.text ?? '' };
  if (w.type === 'metric') {
    const m = METRIC_BY_KEY.get(w.metric ?? '');
    if (!m) return { widget: w, hidden: true };
    if (tv && !m.tvSafe) return { widget: w, hidden: true };                      // sensitive figures never appear on unattended screens
    if (!tv && m.perm && c && !can(c.subject, m.perm).allow) return { widget: w, hidden: true };
    const r = await m.run(q, ctx);
    return { widget: w, value: r.value, sub: r.sub ?? m.label };
  }
  const e = await getEntity(q, w.entity ?? '');
  if (!e || !e.active) return { widget: w, hidden: true };
  if (tv) return w.type === 'entity_count' ? { widget: w, value: n((await q.query<any>(`select count(*)::int c from custom_records where entity_id = $1 and archived_at is null ${w.status ? 'and status = $2' : ''}`, w.status ? [e.id, w.status] : [e.id]))[0].c), sub: e.plural } : { widget: w, hidden: true };
  if (c && !(c.subject.grants.some((g) => g.permissions.includes('*')) || hasAccess(e.access.view, roleKeys(c)))) return { widget: w, hidden: true };
  if (w.type === 'entity_count') return { widget: w, value: n((await q.query<any>(`select count(*)::int c from custom_records where entity_id = $1 and archived_at is null ${w.status ? 'and status = $2' : ''}`, w.status ? [e.id, w.status] : [e.id]))[0].c), sub: `${e.plural}${w.status ? ` · ${w.status}` : ''}` };
  const rows = await q.query<any>(`select id, number, status, data from custom_records where entity_id = $1 and archived_at is null order by created_at desc limit 6`, [e.id]);
  const first = e.fields.find((f) => !f.archived && ['text', 'select'].includes(f.type))?.key;
  return { widget: w, rows: rows.map((r) => ({ title: `${r.number}${first && r.data[first] ? ' · ' + r.data[first] : ''}`, sub: r.status, href: `/m/${e.key}/${r.id}` })) };
}

async function orgCtx(q: Q, orgId: string) {
  const o = (await q.query<any>('select timezone, currency, locale from organizations where id = $1', [orgId]))[0];
  return { tz: o.timezone as string, cur: o.currency as string, loc: o.locale as string };
}

export async function listDashboards(q: Q) { return q.query<any>('select id, slug, name, device, widgets, roles, active from dashboards order by name'); }

export async function saveDashboard(c: Ctx, i: { slug: string; name: string; device: string; widgets: Widget[]; roles: string[] }) {
  need(c, 'builder:manage');
  const s = mkSlug(i.slug || i.name, 40).replace(/_/g, '-');
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(s)) throw new UserError('Choose a short web address (letters, numbers, dashes).');
  if (i.name.trim().length < 2) throw new UserError('Name the dashboard.');
  if (!['any', 'desktop', 'mobile', 'tv'].includes(i.device)) throw new UserError('Unknown device type.');
  if (i.widgets.length === 0 || i.widgets.length > 24) throw new UserError('A dashboard needs between 1 and 24 widgets.');
  for (const w of i.widgets) {
    if (!['metric', 'entity_count', 'entity_list', 'text'].includes(w.type)) throw new UserError('Unknown widget type.');
    if (w.type === 'metric' && !METRIC_BY_KEY.has(w.metric ?? '')) throw new UserError('Unknown metric.');
    if (['entity_count', 'entity_list'].includes(w.type) && !(await getEntity(c.q, w.entity ?? ''))) throw new UserError('Unknown module in a widget.');
    if ((w.title ?? '').length > 60 || (w.text ?? '').length > 600) throw new UserError('Widget text is too long.');
  }
  const widgets = i.widgets.map((w, k) => ({ ...w, id: w.id || `w${k + 1}` }));
  const ex = (await c.q.query<any>('select id from dashboards where slug = $1', [s]))[0];
  if (ex) await c.q.query('update dashboards set name=$2, device=$3, widgets=$4::jsonb, roles=$5::jsonb where id=$1', [ex.id, i.name.trim(), i.device, JSON.stringify(widgets), JSON.stringify(i.roles.length ? i.roles : ['*'])]);
  else await c.q.query('insert into dashboards (org_id, slug, name, device, widgets, roles, created_by) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)', [c.orgId, s, i.name.trim(), i.device, JSON.stringify(widgets), JSON.stringify(i.roles.length ? i.roles : ['*']), c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: ex ? 'builder.dashboard_updated' : 'builder.dashboard_created', entity: 'dashboard', entityId: s, after: { widgets: widgets.length, device: i.device }, ip: c.ip, userAgent: c.userAgent });
  const { invalidateNav } = await import('./builders'); invalidateNav(c.orgId);
  return s;
}

export async function viewDashboard(c: Ctx, slugIn: string) {
  const d = (await c.q.query<any>('select * from dashboards where slug = $1 and active', [slugIn]))[0];
  if (!d) return null;
  const supers = c.subject.grants.some((g) => g.permissions.includes('*'));
  if (!supers && !hasAccess(d.roles, roleKeys(c))) return null;
  const ctx = await orgCtx(c.q, c.orgId);
  const results: WidgetResult[] = [];
  for (const w of d.widgets as Widget[]) results.push(await evalWidget(c, c.q, w, ctx, false));
  return { dash: d, results: results.filter((r) => !r.hidden) };
}

// ---- Wallboards (unattended TV screens) -------------------------------------------------------------------------------------------------------------
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export async function createWallboard(c: Ctx, i: { name: string; dashboardId: string; refreshSeconds: number }) {
  need(c, 'wallboard:manage');
  if (i.name.trim().length < 2) throw new UserError('Name the screen (for example "Newsroom TV").');
  if (!(await c.q.query('select 1 from dashboards where id = $1 and active', [i.dashboardId]))[0]) throw new UserError('Choose a dashboard.');
  const token = crypto.randomBytes(24).toString('base64url');
  const r = await c.q.query<{ id: string }>('insert into wallboard_devices (org_id, name, token_hash, dashboard_id, refresh_seconds, created_by) values ($1,$2,$3,$4,$5,$6) returning id', [c.orgId, i.name.trim(), sha(token), i.dashboardId, Math.min(Math.max(i.refreshSeconds || 60, 15), 3600), c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'wallboard.paired', entity: 'wallboard', entityId: r[0].id, after: { name: i.name }, ip: c.ip, userAgent: c.userAgent });
  return token; // shown once; only its hash is stored
}
export async function listWallboards(q: Q) {
  return q.query<any>('select w.id, w.name, w.refresh_seconds, w.active, w.last_seen_at, d.name as dashboard from wallboard_devices w join dashboards d on d.id = w.dashboard_id order by w.created_at desc');
}
export async function revokeWallboard(c: Ctx, id: string) {
  need(c, 'wallboard:manage');
  await c.q.query('update wallboard_devices set active = false where id = $1', [id]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'wallboard.revoked', entity: 'wallboard', entityId: id, ip: c.ip, userAgent: c.userAgent });
}

/** Read-only data for a paired screen. Only widgets marked wallboard-safe are produced; nothing personal or financial. */
export async function wallboardData(token: string) {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const dev = (await (await privileged()).query<any>(`select w.id, w.org_id, w.name, w.refresh_seconds, d.name as dash_name, d.widgets, o.name as org_name, o.timezone, o.currency, o.locale from wallboard_devices w join dashboards d on d.id = w.dashboard_id join organizations o on o.id = w.org_id where w.token_hash = $1 and w.active and d.active and o.status = 'active'`, [sha(token)]))[0];
  if (!dev) return null;
  const cfg = await withTenant(dev.org_id, async (q) => {
    const ctx = { tz: dev.timezone, cur: dev.currency, loc: dev.locale };
    const out: WidgetResult[] = [];
    for (const w of dev.widgets as Widget[]) out.push(await evalWidget(null, q, w, ctx, true));
    await q.query('update wallboard_devices set last_seen_at = now() where id = $1', [dev.id]);
    return out.filter((r) => !r.hidden);
  });
  return { name: dev.name as string, org: dev.org_name as string, dashboard: dev.dash_name as string, refresh: dev.refresh_seconds as number, results: cfg, at: new Date().toISOString(), tz: dev.timezone as string };
}
