import { can } from '../domain/policy';
import { periodBounds } from '../domain/kpi';
import { fromDb } from '../domain/finance';
import { need, UserError, type Ctx } from './ctx';
import { audit } from './audit';
import { visibleTo } from './calendar';

/** Data for the staff dashboard. Everything here is safe for every signed-in person: names and dates only, nothing private. */
const CUR = `a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)`;
const todayUtc = () => new Date().toISOString().slice(0, 10);

export interface Birthday { name: string; department: string | null; label: string; daysAway: number; today: boolean; years?: number }

/** Days from `from` (YYYY-MM-DD) to the next occurrence of month/day, handling 29 February in non-leap years. */
export function daysUntilNext(from: string, month: number, day: number): number {
  const [y, m, d] = from.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d);
  for (const year of [y, y + 1, y + 2, y + 3, y + 4]) {
    const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day > dim) continue; // 29 Feb in a non-leap year: look at the next year that has it
    const t = Date.UTC(year, month - 1, day);
    if (t >= start) return Math.round((t - start) / 86_400_000);
  }
  return 9999;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export async function upcomingBirthdays(c: Ctx, withinDays = 30, limit = 8): Promise<Birthday[]> {
  const rows = await c.q.query<any>(`select e.full_name, d.name as department, e.birth_date::text as b from employees e left join assignments a on a.employee_id = e.id and ${CUR} left join departments d on d.id = a.department_id
    where e.birth_date is not null and not e.birthday_private and e.status <> 'exited' and not e.hidden`);
  const t = todayUtc();
  return rows.map((r) => { const [, m, d] = r.b.split('-').map(Number); const n = daysUntilNext(t, m, d); return { name: r.full_name as string, department: r.department as string | null, label: `${d} ${MONTHS[m - 1]}`, daysAway: n, today: n === 0 }; })
    .filter((x) => x.daysAway <= withinDays).sort((a, b) => a.daysAway - b.daysAway || a.name.localeCompare(b.name)).slice(0, limit);
}

export async function upcomingAnniversaries(c: Ctx, withinDays = 30, limit = 6): Promise<Birthday[]> {
  const rows = await c.q.query<any>(`select e.full_name, d.name as department, e.joined_on::text as j from employees e left join assignments a on a.employee_id = e.id and ${CUR} left join departments d on d.id = a.department_id where e.status <> 'exited' and not e.hidden`);
  const t = todayUtc();
  return rows.map((r) => { const [jy, m, d] = r.j.split('-').map(Number); const n = daysUntilNext(t, m, d); const nextYear = new Date(Date.parse(`${t}T00:00:00Z`) + n * 86_400_000).getUTCFullYear(); return { name: r.full_name as string, department: r.department as string | null, label: `${d} ${MONTHS[m - 1]}`, daysAway: n, today: n === 0, years: nextYear - jy }; })
    .filter((x) => (x.years ?? 0) >= 1 && x.daysAway <= withinDays).sort((a, b) => a.daysAway - b.daysAway).slice(0, limit);
}

export async function onDutyToday(c: Ctx) {
  const tz = (await c.q.query<{ timezone: string }>('select timezone from organizations where id = $1', [c.orgId]))[0]?.timezone ?? 'Africa/Lagos';
  const rows = await c.q.query<any>(`select e.full_name, d.name as department, s.name as shift, s.start_time::text as st, s.end_time::text as en,
      exists (select 1 from attendance_sessions x where x.employee_id = e.id and x.status = 'open') as here
    from roster_entries r join employees e on e.id = r.employee_id join shifts s on s.id = r.shift_id left join assignments a on a.employee_id = e.id and ${CUR} left join departments d on d.id = a.department_id
    where r.status = 'published' and r.superseded_at is null and r.work_date = (now() at time zone $1)::date and not e.hidden order by s.start_time, e.full_name limit 40`, [tz]);
  const leave = await c.q.query<any>(`select e.full_name, t.name as type from leave_requests l join employees e on e.id = l.employee_id join leave_types t on t.id = l.leave_type_id where l.status = 'approved' and (now() at time zone $1)::date between l.start_date and l.end_date and not e.hidden order by e.full_name limit 20`, [tz]);
  return { duty: rows.map((r) => ({ name: r.full_name as string, department: r.department as string | null, shift: r.shift as string, time: `${String(r.st).slice(0, 5)}-${String(r.en).slice(0, 5)}`, here: !!r.here })), leave: leave.map((l) => ({ name: l.full_name as string, type: l.type as string })) };
}

export async function stationPulse(c: Ctx) {
  const tz = (await c.q.query<{ timezone: string }>('select timezone from organizations where id = $1', [c.orgId]))[0]?.timezone ?? 'Africa/Lagos';
  const r = (await c.q.query<any>(`select (select count(*)::int from employees where status = 'active' and not hidden) staff,
      (select count(*)::int from attendance_sessions where work_date = (now() at time zone $1)::date) clocked,
      (select count(*)::int from attendance_sessions where work_date = (now() at time zone $1)::date and late_minutes > 0) late,
      (select count(*)::int from attendance_sessions where status = 'open') here`, [tz]))[0];
  return { staff: r.staff as number, clockedToday: r.clocked as number, lateToday: r.late as number, hereNow: r.here as number };
}

export async function upcomingEvents(c: Ctx, limit = 5) {
  if (!can(c.subject, 'calendar:view').allow) return [];
  const rows = await c.q.query<any>(`select id, title, kind, starts_at, location, roles from events where starts_at >= now() - interval '2 hours' and starts_at < now() + interval '30 days' order by starts_at limit 30`);
  return rows.filter((e) => visibleTo(c, e.roles)).slice(0, limit).map((e) => ({ id: e.id as string, title: e.title as string, kind: e.kind as string, startsAt: new Date(e.starts_at).toISOString(), location: e.location as string | null }));
}

// ---- Marketing statistics --------------------------------------------------------------------------------------------------------------------------------------------
export interface Marketing {
  money: boolean;
  stages: { stage: string; count: number; value: number }[];
  months: { label: string; won: number; wonValue: number; leads: number }[];
  winRate: number | null; openCount: number; openValue: number; wonThisMonth: number; wonValueThisMonth: number; newLeadsThisMonth: number; clients: number;
  top: { id: string; name: string; value: number }[];
  followUpsDue: number;
}

/** Counts are shown to everyone; money values only to people who may see CRM or finance. */
export async function marketingStats(c: Ctx): Promise<Marketing> {
  const money = can(c.subject, 'crm:view').allow || can(c.subject, 'finance:view').allow;
  const stages = await c.q.query<any>(`select stage, count(*)::int n, coalesce(sum(value),0) v from crm_opportunities group by stage`);
  const order = ['new', 'contacted', 'proposal', 'negotiation', 'won', 'lost'];
  const st = order.map((s) => { const r = stages.find((x) => x.stage === s); return { stage: s, count: r ? Number(r.n) : 0, value: r ? fromDb(r.v) : 0 }; });
  const cur = periodBounds(todayUtc().slice(0, 7));
  const months: Marketing['months'] = [];
  for (let k = 5; k >= 0; k--) {
    const d = new Date(Date.UTC(Number(cur.from.slice(0, 4)), Number(cur.from.slice(5, 7)) - 1 - k, 1));
    const p = d.toISOString().slice(0, 7); const b = periodBounds(p);
    const w = (await c.q.query<any>(`select count(*)::int n, coalesce(sum(value),0) v from crm_opportunities where stage = 'won' and closed_at >= $1::date and closed_at < $2::date`, [b.from, b.next]))[0];
    const l = (await c.q.query<any>(`select count(*)::int n from crm_accounts where created_at >= $1::date and created_at < $2::date`, [b.from, b.next]))[0];
    months.push({ label: MONTHS[d.getUTCMonth()], won: Number(w.n), wonValue: fromDb(w.v), leads: Number(l.n) });
  }
  const open = st.filter((s) => !['won', 'lost'].includes(s.stage));
  const won = st.find((s) => s.stage === 'won')!, lost = st.find((s) => s.stage === 'lost')!;
  const top = money ? (await c.q.query<any>(`select a.id, a.name, coalesce(sum(o.value),0) v from crm_accounts a join crm_opportunities o on o.account_id = a.id and o.stage not in ('won','lost') group by a.id, a.name order by v desc limit 5`)).map((r) => ({ id: r.id as string, name: r.name as string, value: fromDb(r.v) })) : [];
  const fu = (await c.q.query<any>(`select count(*)::int n from crm_activities where follow_up_on <= current_date and not follow_up_done`))[0];
  const clients = (await c.q.query<any>(`select count(*)::int n from crm_accounts where status = 'client'`))[0];
  const nm = months[months.length - 1];
  return { money, stages: st.map((s) => (money ? s : { ...s, value: 0 })), months: months.map((m) => (money ? m : { ...m, wonValue: 0 })), winRate: won.count + lost.count > 0 ? Math.round((won.count / (won.count + lost.count)) * 100) : null,
    openCount: open.reduce((a, s) => a + s.count, 0), openValue: money ? open.reduce((a, s) => a + s.value, 0) : 0, wonThisMonth: nm.won, wonValueThisMonth: money ? nm.wonValue : 0, newLeadsThisMonth: nm.leads, clients: Number(clients.n), top, followUpsDue: Number(fu.n) };
}

/** Income by month from the ledger, for people who may see finance. Returns null for everyone else. */
export async function incomeTrend(c: Ctx): Promise<{ label: string; income: number; expense: number }[] | null> {
  if (!can(c.subject, 'finance:view').allow) return null;
  const rows = await c.q.query<any>(`select to_char(date_trunc('month', e.entry_date), 'YYYY-MM') as m, a.type, coalesce(sum(l.credit - l.debit),0) as net
    from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id join fin_accounts a on a.id = l.account_id
    where a.type in ('income','expense') and e.entry_date >= (date_trunc('month', current_date) - interval '5 months')::date group by 1, 2`);
  const out: { label: string; income: number; expense: number }[] = [];
  const cur = new Date(`${todayUtc().slice(0, 7)}-01T00:00:00Z`);
  for (let k = 5; k >= 0; k--) {
    const d = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() - k, 1));
    const key = d.toISOString().slice(0, 7);
    const inc = rows.find((r) => r.m === key && r.type === 'income'), exp = rows.find((r) => r.m === key && r.type === 'expense');
    out.push({ label: MONTHS[d.getUTCMonth()], income: inc ? fromDb(inc.net) : 0, expense: exp ? -fromDb(exp.net) : 0 });
  }
  return out;
}

// ---- Profile: birthday ----------------------------------------------------------------------------------------------------------------------------------------------
export async function myProfile(c: Ctx) {
  need(c, 'profile:edit:own');
  if (!c.subject.employeeId) return null;
  return (await c.q.query<any>('select full_name, phone, birth_date::text as birth_date, birthday_private from employees where id = $1', [c.subject.employeeId]))[0] ?? null;
}

export async function saveMyProfile(c: Ctx, i: { phone?: string; birthDate?: string; birthdayPrivate?: boolean }) {
  need(c, 'profile:edit:own');
  if (!c.subject.employeeId) throw new UserError('Your login is not linked to an employee record. Ask HR to link it.');
  let bd: string | null = null;
  if (i.birthDate?.trim()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i.birthDate) || Number.isNaN(Date.parse(i.birthDate))) throw new UserError('Enter a valid date of birth.');
    const y = Number(i.birthDate.slice(0, 4));
    if (i.birthDate > todayUtc() || y < 1920 || y > new Date().getUTCFullYear() - 14) throw new UserError('That date of birth does not look right.');
    bd = i.birthDate;
  }
  await c.q.query('update employees set phone = $2, birth_date = $3, birthday_private = $4 where id = $1', [c.subject.employeeId, i.phone?.trim() || null, bd, !!i.birthdayPrivate]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'profile.updated', entity: 'employee', entityId: c.subject.employeeId, after: { birthdayPrivate: !!i.birthdayPrivate, hasBirthDate: !!bd }, ip: c.ip, userAgent: c.userAgent });
}
