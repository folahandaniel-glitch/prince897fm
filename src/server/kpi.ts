import { bandOfRank, composite, DEPARTMENT_CORE, GENERIC_CORE, KPI_LIBRARY, LEVEL_BANDS, periodBounds, pickProfile, ratingOf, scoreMetric, standardTarget, standardWeights, type LevelBand, type MetricSource } from '../domain/kpi';
import { fromDb } from '../domain/finance';
import { can } from '../domain/policy';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import type { Q } from './db';

const CUR = `a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)`;
const today = () => new Date().toISOString().slice(0, 10);
const okPeriod = (p: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

// ---- Standard KPIs ---------------------------------------------------------------------------------------------------------------------------------------------
/** Installs the standard metric library and the department/level profiles. Safe to run again: existing items are left untouched. */
export async function ensureKpiDefaults(q: Q, orgId: string): Promise<{ metrics: number; profiles: number }> {
  let metrics = 0, profiles = 0;
  const ids = new Map<string, string>();
  for (const m of KPI_LIBRARY) {
    const r = await q.query<{ id: string }>('insert into kpi_metrics (org_id, key, name, description, source, unit) values ($1,$2,$3,$4,$5,$6) on conflict (org_id, key) do nothing returning id', [orgId, m.key, m.name, m.description, m.source, m.unit ?? '%']);
    if (r[0]) metrics++;
  }
  for (const r of await q.query<{ id: string; key: string }>('select id, key from kpi_metrics')) ids.set(r.key, r.id);
  const depts = await q.query<{ id: string; name: string }>('select id, name from departments where archived_at is null');
  const scopes: { name: string; dept: string | null; core: typeof GENERIC_CORE; targets?: Record<string, number> }[] = [{ name: 'Standard', dept: null, core: GENERIC_CORE }];
  for (const d of depts) { const f = DEPARTMENT_CORE.find((x) => x.match.test(d.name)); if (f) scopes.push({ name: d.name, dept: d.id, core: f.weights, targets: f.targets }); }
  for (const s of scopes) {
    for (const band of [null, ...LEVEL_BANDS.map((b) => b.key)] as (LevelBand | null)[]) {
      if (s.dept == null && band == null) { /* organisation-wide default uses the generic core at senior level */ }
      const exists = (await q.query('select 1 from kpi_profiles where department_id is not distinct from $1 and level_band is not distinct from $2', [s.dept, band]))[0];
      if (exists) continue;
      if (s.dept != null && band == null) continue; // department rows are per level; the generic row covers "any level"
      const label = band ? `${s.name}: ${LEVEL_BANDS.find((b) => b.key === band)!.label}` : s.name;
      const p = (await q.query<{ id: string }>('insert into kpi_profiles (org_id, name, department_id, level_band) values ($1,$2,$3,$4) returning id', [orgId, label, s.dept, band]))[0];
      profiles++;
      for (const [k, w] of standardWeights(s.core, band ?? 'senior')) {
        const mid = ids.get(k); if (!mid) continue;
        await q.query('insert into kpi_profile_metrics (org_id, profile_id, metric_id, weight, target) values ($1,$2,$3,$4,$5)', [orgId, p.id, mid, w, standardTarget(k, band ?? 'senior', s.targets)]);
      }
    }
  }
  return { metrics, profiles };
}

export async function listMetrics(q: Q) { return q.query<any>('select id, key, name, description, source, unit from kpi_metrics where active order by source = \'manual\', name'); }

export async function listProfiles(c: Ctx) {
  need(c, 'kpi:view');
  const profiles = await c.q.query<any>(`select p.id, p.name, p.department_id, p.level_band, p.active, d.name as department from kpi_profiles p left join departments d on d.id = p.department_id order by (p.department_id is null) desc, d.name, array_position(array['executive','management','supervisory','senior','junior','intern'], p.level_band)`);
  const rows = await c.q.query<any>('select pm.profile_id, pm.metric_id, pm.weight, pm.target, m.key, m.name, m.source, m.unit from kpi_profile_metrics pm join kpi_metrics m on m.id = pm.metric_id order by pm.weight desc');
  return profiles.map((p) => ({ ...p, metrics: rows.filter((r) => r.profile_id === p.id).map((r) => ({ metricId: r.metric_id, key: r.key, name: r.name, source: r.source, unit: r.unit, weight: Number(r.weight), target: r.target == null ? null : Number(r.target) })) }));
}

export async function createProfile(c: Ctx, i: { departmentId?: string | null; levelBand?: string | null }) {
  need(c, 'kpi:manage');
  const band = i.levelBand ? (LEVEL_BANDS.find((b) => b.key === i.levelBand)?.key ?? null) : null;
  if (i.levelBand && !band) throw new UserError('Unknown level.');
  const dept = i.departmentId ? (await c.q.query<any>('select id, name from departments where id = $1', [i.departmentId]))[0] : null;
  if (i.departmentId && !dept) throw new UserError('Unknown department.');
  if (!dept && !band) throw new UserError('Choose a department, a level, or both.');
  if ((await c.q.query('select 1 from kpi_profiles where department_id is not distinct from $1 and level_band is not distinct from $2', [dept?.id ?? null, band]))[0]) throw new UserError('A profile for that department and level already exists. Edit it instead.');
  const fam = dept ? DEPARTMENT_CORE.find((x) => x.match.test(dept.name)) : null;
  const core = fam?.weights ?? GENERIC_CORE;
  const name = [dept?.name ?? 'All departments', band ? LEVEL_BANDS.find((b) => b.key === band)!.label : 'all levels'].join(': ');
  const p = (await c.q.query<{ id: string }>('insert into kpi_profiles (org_id, name, department_id, level_band) values ($1,$2,$3,$4) returning id', [c.orgId, name, dept?.id ?? null, band]))[0];
  const ids = new Map((await c.q.query<{ id: string; key: string }>('select id, key from kpi_metrics')).map((r) => [r.key, r.id]));
  for (const [k, w] of standardWeights(core, band ?? 'senior')) { const mid = ids.get(k); if (mid) await c.q.query('insert into kpi_profile_metrics (org_id, profile_id, metric_id, weight, target) values ($1,$2,$3,$4,$5)', [c.orgId, p.id, mid, w, standardTarget(k, band ?? 'senior', fam?.targets)]); }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'kpi.profile_created', entity: 'kpi_profile', entityId: p.id, after: { name }, ip: c.ip, userAgent: c.userAgent });
  return p.id;
}

/** Replace a profile's metrics. The weights must add up to 100. */
export async function saveProfile(c: Ctx, profileId: string, items: { metricId: string; weight: number; target?: number | null }[], active = true) {
  need(c, 'kpi:manage');
  if (!(await c.q.query('select 1 from kpi_profiles where id = $1', [profileId]))[0]) throw new UserError('Profile not found.');
  const clean = items.filter((x) => x.weight > 0);
  if (clean.length === 0) throw new UserError('A profile needs at least one metric.');
  if (clean.some((x) => !(x.weight > 0 && x.weight <= 100))) throw new UserError('Each weight must be between 0 and 100.');
  const total = Math.round(clean.reduce((a, x) => a + x.weight, 0) * 100) / 100;
  if (Math.abs(total - 100) > 0.01) throw new UserError(`The weights add up to ${total}. They must add up to exactly 100.`);
  if (new Set(clean.map((x) => x.metricId)).size !== clean.length) throw new UserError('A metric appears twice.');
  const valid = await c.q.query<{ id: string }>('select id from kpi_metrics where id = any($1::uuid[])', [clean.map((x) => x.metricId)]);
  if (valid.length !== clean.length) throw new UserError('Unknown metric.');
  await c.q.query('delete from kpi_profile_metrics where profile_id = $1', [profileId]);
  for (const x of clean) await c.q.query('insert into kpi_profile_metrics (org_id, profile_id, metric_id, weight, target) values ($1,$2,$3,$4,$5)', [c.orgId, profileId, x.metricId, x.weight, x.target ?? null]);
  await c.q.query('update kpi_profiles set active = $2 where id = $1', [profileId, active]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'kpi.profile_saved', entity: 'kpi_profile', entityId: profileId, after: { metrics: clean.length, active }, ip: c.ip, userAgent: c.userAgent });
}

// ---- Measuring ---------------------------------------------------------------------------------------------------------------------------------------------------
interface Emp { id: string; user_id: string | null; full_name: string; department_id: string | null; branch_id: string | null; department: string | null; position: string | null; rank_level: number | null }

async function employee(q: Q, id: string): Promise<Emp | null> {
  return (await q.query<Emp>(`select e.id, e.user_id, e.full_name, a.department_id, a.branch_id, d.name as department, p.name as position, p.rank_level from employees e
    left join assignments a on a.employee_id = e.id and ${CUR} left join departments d on d.id = a.department_id left join positions p on p.id = a.position_id where e.id = $1 and not e.hidden`, [id]))[0] ?? null;
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10000) / 100 : null);

/** The measured value of one metric for one person in one month, or null when there is nothing to measure. */
export async function measure(q: Q, source: MetricSource, e: Emp, period: string, metricId?: string): Promise<number | null> {
  const { from, to, next } = periodBounds(period);
  const upto = to < today() ? to : today();
  const one = async (sql: string, p: unknown[]) => (await q.query<any>(sql, p))[0] ?? {};
  switch (source) {
    case 'punctuality': { const r = await one(`select count(*)::int n, count(*) filter (where late_minutes = 0)::int ok from attendance_sessions where employee_id = $1 and work_date between $2::date and $3::date`, [e.id, from, to]); return pct(r.ok, r.n); }
    case 'attendance': {
      const rostered = Number((await one(`select count(*)::int n from roster_entries where employee_id = $1 and status = 'published' and superseded_at is null and work_date between $2::date and $3::date`, [e.id, from, upto])).n);
      const worked = Number((await one(`select count(*)::int n from attendance_sessions where employee_id = $1 and work_date between $2::date and $3::date`, [e.id, from, upto])).n);
      const v = pct(Math.min(worked, rostered), rostered); return v;
    }
    case 'task_completion': { const r = await one(`select count(*)::int n, count(*) filter (where status = 'done')::int ok from tasks where assignee_employee_id = $1 and status <> 'cancelled' and due_date between $2::date and $3::date`, [e.id, from, to]); return pct(r.ok, r.n); }
    case 'task_timeliness': { const r = await one(`select count(*)::int n, count(*) filter (where completed_at::date <= due_date)::int ok from tasks where assignee_employee_id = $1 and status = 'done' and due_date between $2::date and $3::date`, [e.id, from, to]); return pct(r.ok, r.n); }
    case 'report_submission': { const r = await one(`select count(*)::int n, count(*) filter (where status <> 'draft' and coalesce(on_time, false))::int ok from reports where employee_id = $1 and due_at >= $2::date and due_at < $3::date and (due_at < now() or status <> 'draft')`, [e.id, from, next]); return pct(r.ok, r.n); }
    case 'knowledge': { const r = await one(`select t.score_pct from assessment_attempts t join assessments a on a.id = t.assessment_id where t.employee_id = $1 and a.period = $2 and t.status = 'submitted'`, [e.id, period]); return r.score_pct == null ? null : Number(r.score_pct); }
    case 'sales_target': { if (!e.user_id) return null; const r = await one(`select coalesce(sum(value),0) v, count(*)::int n from crm_opportunities where owner_user_id = $1 and stage = 'won' and closed_at >= $2::date and closed_at < $3::date`, [e.user_id, from, next]); return Number(r.v); }
    case 'new_clients': { if (!e.user_id) return null; const r = await one(`select count(*)::int n from crm_accounts where created_by = $1 and status = 'client' and created_at >= $2::date and created_at < $3::date`, [e.user_id, from, next]); return Number(r.n); }
    case 'followups': { if (!e.user_id) return null; const r = await one(`select count(*)::int n, count(*) filter (where follow_up_done)::int ok from crm_activities where by_user = $1 and follow_up_on between $2::date and $3::date`, [e.user_id, from, to]); return pct(r.ok, r.n); }
    case 'ticket_sla': { if (!e.user_id) return null; const r = await one(`select count(*)::int n, count(*) filter (where resolved_at <= sla_due_at)::int ok from tickets where assignee_user_id = $1 and resolved_at >= $2::date and resolved_at < $3::date and sla_due_at is not null`, [e.user_id, from, next]); return pct(r.ok, r.n); }
    case 'manual': { if (!metricId) return null; const r = await one('select value from kpi_manual_scores where employee_id = $1 and metric_id = $2 and period = $3', [e.id, metricId, period]); return r.value == null ? null : Number(r.value); }
  }
}

export interface KpiLine { key: string; name: string; source: string; unit: string; weight: number; target: number | null; value: number | null; score: number | null }
export interface KpiCard { employeeId: string; name: string; department: string | null; position: string | null; band: LevelBand; period: string; profile: string | null; score: number | null; rating: string; tone: string; coverage: number; lines: KpiLine[]; status: 'draft' | 'final' }

/** Works out (and stores) one person's KPI for a month. A finalised result is returned as it was locked. */
export async function computeCard(q: Q, orgId: string, employeeId: string, period: string, force = false, reuseMinutes = 0): Promise<KpiCard | null> {
  const e = await employee(q, employeeId);
  if (!e) return null;
  const band = bandOfRank(e.rank_level);
  const stored = (await q.query<any>('select * from kpi_results where employee_id = $1 and period = $2', [employeeId, period]))[0];
  if (stored?.status === 'final' && !force) {
    const r = ratingOf(stored.score == null ? null : Number(stored.score));
    return { employeeId, name: e.full_name, department: e.department, position: e.position, band, period, profile: stored.profile_name, score: stored.score == null ? null : Number(stored.score), rating: r.label, tone: r.tone, coverage: Number(stored.coverage ?? 0), lines: stored.detail, status: 'final' };
  }
  if (stored && stored.status === 'draft' && reuseMinutes > 0 && Date.now() - new Date(stored.computed_at).getTime() < reuseMinutes * 60_000 && !force) {
    const r = ratingOf(stored.score == null ? null : Number(stored.score));
    return { employeeId, name: e.full_name, department: e.department, position: e.position, band, period, profile: stored.profile_name, score: stored.score == null ? null : Number(stored.score), rating: r.label, tone: r.tone, coverage: Number(stored.coverage ?? 0), lines: stored.detail, status: 'draft' };
  }
  await ensureKpiDefaults(q, orgId).catch(() => undefined);
  const profiles = (await q.query<any>('select id, name, department_id, level_band, active from kpi_profiles')).map((p) => ({ id: p.id as string, name: p.name as string, departmentId: p.department_id as string | null, levelBand: p.level_band as LevelBand | null, active: p.active as boolean }));
  const prof = pickProfile(profiles, e.department_id, band);
  const lines: KpiLine[] = [];
  if (prof) {
    const rows = await q.query<any>('select pm.weight, pm.target, m.id as metric_id, m.key, m.name, m.source, m.unit from kpi_profile_metrics pm join kpi_metrics m on m.id = pm.metric_id where pm.profile_id = $1 order by pm.weight desc', [prof.id]);
    for (const r of rows) {
      const value = await measure(q, r.source, e, period, r.metric_id);
      const target = r.target == null ? null : Number(r.target);
      lines.push({ key: r.key, name: r.name, source: r.source, unit: r.unit, weight: Number(r.weight), target, value, score: r.source === 'manual' ? value : scoreMetric(value, target) });
    }
  }
  const { score, coverage } = composite(lines.map((l) => ({ key: l.key, name: l.name, weight: l.weight, score: l.score })));
  const rating = ratingOf(score);
  await q.query(`insert into kpi_results (org_id, employee_id, period, profile_id, profile_name, score, rating, coverage, detail, status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'draft')
    on conflict (employee_id, period) do update set profile_id = excluded.profile_id, profile_name = excluded.profile_name, score = excluded.score, rating = excluded.rating, coverage = excluded.coverage, detail = excluded.detail, computed_at = now()
    where kpi_results.status = 'draft' or $10`, [orgId, employeeId, period, prof?.id ?? null, prof?.name ?? null, score, rating.label, coverage, JSON.stringify(lines), force]);
  return { employeeId, name: e.full_name, department: e.department, position: e.position, band, period, profile: prof?.name ?? null, score, rating: rating.label, tone: rating.tone, coverage, lines, status: 'draft' };
}

/** My own scorecard. */
export async function myCard(c: Ctx, period: string, reuseMinutes = 0): Promise<KpiCard | null> {
  need(c, 'kpi:view:own');
  if (!okPeriod(period)) throw new UserError('Choose a month.');
  if (!c.subject.employeeId) return null;
  return computeCard(c.q, c.orgId, c.subject.employeeId, period, false, reuseMinutes);
}

export async function myTrend(c: Ctx, months = 6): Promise<{ period: string; score: number | null }[]> {
  need(c, 'kpi:view:own');
  if (!c.subject.employeeId) return [];
  const rows = await c.q.query<any>('select period, score from kpi_results where employee_id = $1 order by period desc limit $2', [c.subject.employeeId, months]);
  return rows.reverse().map((r) => ({ period: r.period, score: r.score == null ? null : Number(r.score) }));
}

/** Everyone I am allowed to see (by department/branch scope), computed for the month. */
export async function teamCards(c: Ctx, period: string): Promise<KpiCard[]> {
  need(c, 'kpi:view');
  if (!okPeriod(period)) throw new UserError('Choose a month.');
  const people = await c.q.query<any>(`select e.id, a.department_id, a.branch_id from employees e left join assignments a on a.employee_id = e.id and ${CUR} where e.status <> 'exited' and not e.hidden order by e.full_name limit 300`);
  const out: KpiCard[] = [];
  for (const p of people) {
    if (!can(c.subject, 'kpi:view', { departmentId: p.department_id, branchId: p.branch_id }).allow) continue;
    const k = await computeCard(c.q, c.orgId, p.id, period);
    if (k) out.push(k);
  }
  return out;
}

/** One person's card for a manager. Needs access to that person's department. */
export async function cardFor(c: Ctx, employeeId: string, period: string): Promise<KpiCard | null> {
  if (!okPeriod(period)) throw new UserError('Choose a month.');
  const e = await employee(c.q, employeeId);
  if (!e) return null;
  if (c.subject.employeeId !== employeeId) need(c, 'kpi:view', { departmentId: e.department_id, branchId: e.branch_id });
  else need(c, 'kpi:view:own');
  return computeCard(c.q, c.orgId, employeeId, period);
}

/** A supervisor's rating for a manual metric. Nobody can rate themselves. */
export async function rate(c: Ctx, employeeId: string, metricKey: string, period: string, value: number, note?: string) {
  if (!okPeriod(period)) throw new UserError('Choose a month.');
  const e = await employee(c.q, employeeId);
  if (!e) throw new UserError('Employee not found.');
  need(c, 'kpi:rate', { departmentId: e.department_id, branchId: e.branch_id });
  if (c.subject.employeeId === employeeId) throw new UserError('Separation of duties: you cannot rate your own performance.');
  if (!(value >= 0 && value <= 100)) throw new UserError('The rating must be between 0 and 100.');
  const m = (await c.q.query<any>(`select id, name from kpi_metrics where key = $1 and source = 'manual'`, [metricKey]))[0];
  if (!m) throw new UserError('That metric is measured automatically; it cannot be rated by hand.');
  if ((await c.q.query(`select 1 from kpi_results where employee_id = $1 and period = $2 and status = 'final'`, [employeeId, period]))[0]) throw new UserError('This month is finalised. Ask an administrator to reopen it.');
  await c.q.query(`insert into kpi_manual_scores (org_id, employee_id, metric_id, period, value, note, entered_by) values ($1,$2,$3,$4,$5,$6,$7)
    on conflict (employee_id, metric_id, period) do update set value = excluded.value, note = excluded.note, entered_by = excluded.entered_by, updated_at = now()`, [c.orgId, employeeId, m.id, period, value, note?.trim() || null, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'kpi.rated', entity: 'employee', entityId: employeeId, after: { metric: metricKey, period, value }, ip: c.ip, userAgent: c.userAgent });
  await computeCard(c.q, c.orgId, employeeId, period);
}

/** Locks the month's result so it can no longer change; reopening needs the same permission. */
export async function finalise(c: Ctx, employeeId: string, period: string, reopen = false) {
  need(c, 'kpi:manage');
  if (!okPeriod(period)) throw new UserError('Choose a month.');
  if (reopen) {
    await c.q.query(`update kpi_results set status = 'draft', finalised_by = null, finalised_at = null where employee_id = $1 and period = $2`, [employeeId, period]);
  } else {
    if (period >= new Date().toISOString().slice(0, 7)) throw new UserError('A month can be finalised only after it has ended.');
    await computeCard(c.q, c.orgId, employeeId, period);
    await c.q.query(`update kpi_results set status = 'final', finalised_by = $3, finalised_at = now() where employee_id = $1 and period = $2`, [employeeId, period, c.userId]);
  }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: reopen ? 'kpi.reopened' : 'kpi.finalised', entity: 'employee', entityId: employeeId, after: { period }, ip: c.ip, userAgent: c.userAgent });
}

export const kpiNumber = fromDb;
