import { addDays, localParts } from '../domain/attendance';
import { hasAccess } from '../domain/builders';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import { roleKeys } from './builders';

const CUR = `a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)`;
const supers = (c: Ctx) => c.subject.grants.some((g) => g.permissions.includes('*'));
const visibleTo = (c: Ctx, roles: string[]) => supers(c) || hasAccess(roles, roleKeys(c));

export async function createEvent(c: Ctx, i: { title: string; kind: string; startsAt: string; endsAt?: string; allDay?: boolean; location?: string; description?: string; roles: string[]; departmentIds?: string[] }) {
  need(c, 'event:create');
  if (i.title.trim().length < 2) throw new UserError('Give the event a title.');
  if (!['meeting', 'event', 'deadline', 'training', 'other'].includes(i.kind)) throw new UserError('Choose a type.');
  const s = new Date(i.startsAt), e = i.endsAt ? new Date(i.endsAt) : null;
  if (Number.isNaN(s.getTime())) throw new UserError('Enter a valid start date and time.');
  if (e && (Number.isNaN(e.getTime()) || e < s)) throw new UserError('The event cannot end before it starts.');
  const r = await c.q.query<{ id: string }>('insert into events (org_id, title, description, location, kind, starts_at, ends_at, all_day, roles, department_ids, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) returning id',
    [c.orgId, i.title.trim(), i.description || null, i.location || null, i.kind, s, e, !!i.allDay, JSON.stringify(i.roles.length ? i.roles : ['*']), i.departmentIds?.length ? i.departmentIds : null, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'calendar.event_created', entity: 'event', entityId: r[0].id, after: { title: i.title, kind: i.kind }, ip: c.ip, userAgent: c.userAgent });
}

export interface CalItem { date: string; time?: string; title: string; kind: 'shift' | 'leave' | 'task' | 'report' | 'event' | 'meeting' | 'deadline' | 'training' | 'other'; href?: string; sub?: string }

/** One calendar for the signed-in person: their shifts, approved leave, task due dates, report deadlines, and events they are invited to. */
export async function monthView(c: Ctx, month: string) {
  need(c, 'calendar:view');
  if (!/^\d{4}-\d{2}$/.test(month)) throw new UserError('Choose a month.');
  const from = `${month}-01`, to = addDays(`${month}-01`, 31 - 1 + 1).slice(0, 10) > `${month}-31` ? `${month}-31` : addDays(`${month}-01`, 30);
  const tz = (await c.q.query<{ timezone: string }>('select timezone from organizations where id = $1', [c.orgId]))[0]?.timezone ?? 'Africa/Lagos';
  const emp = (await c.q.query<any>(`select e.id, a.department_id from employees e left join assignments a on a.employee_id = e.id and ${CUR} where e.user_id = $1`, [c.userId]))[0];
  const items: CalItem[] = [];
  if (emp) {
    for (const r of await c.q.query<any>(`select r.work_date::text as d, s.name, s.start_time::text as st, s.end_time::text as en from roster_entries r join shifts s on s.id = r.shift_id where r.employee_id = $1 and r.status = 'published' and r.superseded_at is null and r.work_date between $2::date and $3::date`, [emp.id, from, to]))
      items.push({ date: r.d, time: `${String(r.st).slice(0, 5)}-${String(r.en).slice(0, 5)}`, title: `Shift: ${r.name}`, kind: 'shift', href: '/attendance' });
    for (const l of await c.q.query<any>(`select start_date::text as s, end_date::text as e, t.name from leave_requests l join leave_types t on t.id = l.leave_type_id where l.employee_id = $1 and l.status = 'approved' and l.start_date <= $3::date and l.end_date >= $2::date`, [emp.id, from, to]))
      for (let d = l.s < from ? from : l.s; d <= l.e && d <= to; d = addDays(d, 1)) items.push({ date: d, title: `Leave: ${l.name}`, kind: 'leave', href: '/leave' });
    for (const t of await c.q.query<any>(`select id, title, due_date::text as d from tasks where assignee_employee_id = $1 and due_date between $2::date and $3::date and status in ('todo','in_progress','blocked')`, [emp.id, from, to]))
      items.push({ date: t.d, title: `Due: ${t.title}`, kind: 'task', href: `/tasks/${t.id}` });
    for (const r of await c.q.query<any>(`select r.id, r.due_at, t.name from reports r join report_templates t on t.id = r.template_id where r.employee_id = $1 and r.status in ('draft','returned') and r.due_at::date between $2::date and $3::date`, [emp.id, from, to]))
      items.push({ date: localParts(new Date(r.due_at), tz).date, time: localParts(new Date(r.due_at), tz).minutes ? `${String(Math.floor(localParts(new Date(r.due_at), tz).minutes / 60)).padStart(2, '0')}:${String(localParts(new Date(r.due_at), tz).minutes % 60).padStart(2, '0')}` : undefined, title: `${r.name} due`, kind: 'report', href: '/reports' });
  }
  for (const e of await c.q.query<any>(`select id, title, kind, starts_at, location, roles, department_ids from events where starts_at >= $1::date - interval '1 day' and starts_at < $2::date + interval '2 days' order by starts_at`, [from, to])) {
    if (!visibleTo(c, e.roles)) continue;
    if (e.department_ids?.length && !supers(c) && !(emp?.department_id && e.department_ids.includes(emp.department_id))) continue;
    const p = localParts(new Date(e.starts_at), tz);
    if (p.date < from || p.date > to) continue;
    items.push({ date: p.date, time: `${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}`, title: e.title, kind: e.kind, sub: e.location ?? undefined });
  }
  return { month, from, to, items: items.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '')) };
}

// ---- Announcements ------------------------------------------------------------------------------------------------------------------------------
export async function postAnnouncement(c: Ctx, i: { title: string; body: string; roles: string[]; pinned?: boolean; expiresOn?: string }) {
  need(c, 'announcement:post');
  if (i.title.trim().length < 2 || i.body.trim().length < 1) throw new UserError('Add a title and a message.');
  if (i.expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(i.expiresOn)) throw new UserError('Enter a valid expiry date.');
  const r = await c.q.query<{ id: string }>('insert into announcements (org_id, title, body, roles, pinned, expires_on, created_by) values ($1,$2,$3,$4::jsonb,$5,$6,$7) returning id', [c.orgId, i.title.trim(), i.body.trim(), JSON.stringify(i.roles.length ? i.roles : ['*']), !!i.pinned, i.expiresOn || null, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'announcement.posted', entity: 'announcement', entityId: r[0].id, after: { title: i.title }, ip: c.ip, userAgent: c.userAgent });
}

export async function activeAnnouncements(c: Ctx) {
  const rows = await c.q.query<any>(`select a.id, a.title, a.body, a.roles, a.pinned, a.created_at, a.starts_on::text as starts_on, a.expires_on::text as expires_on, u.email as author from announcements a join users u on u.id = a.created_by where a.starts_on <= current_date and (a.expires_on is null or a.expires_on >= current_date) order by a.pinned desc, a.created_at desc limit 20`);
  return rows.filter((r) => visibleTo(c, r.roles)).slice(0, 8);
}

export async function removeAnnouncement(c: Ctx, id: string) {
  need(c, 'announcement:post');
  await c.q.query('delete from announcements where id = $1', [id]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'announcement.removed', entity: 'announcement', entityId: id, ip: c.ip, userAgent: c.userAgent });
}

/** Edit an announcement in place (title, message, audience, pin, start and expiry dates). */
export async function updateAnnouncement(c: Ctx, id: string, i: { title: string; body: string; roles: string[]; pinned?: boolean; startsOn?: string; expiresOn?: string }) {
  need(c, 'announcement:post');
  if (i.title.trim().length < 2 || i.body.trim().length < 1) throw new UserError('Add a title and a message.');
  const okDate = (s?: string) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!okDate(i.expiresOn) || !okDate(i.startsOn)) throw new UserError('Enter valid dates.');
  if (i.startsOn && i.expiresOn && i.expiresOn < i.startsOn) throw new UserError('The expiry date cannot be before the start date.');
  const r = await c.q.query('update announcements set title=$2, body=$3, roles=$4::jsonb, pinned=$5, starts_on=coalesce($6::date, starts_on), expires_on=$7 where id=$1 returning id', [id, i.title.trim(), i.body.trim(), JSON.stringify(i.roles.length ? i.roles : ['*']), !!i.pinned, i.startsOn || null, i.expiresOn || null]);
  if (!r[0]) throw new UserError('Announcement not found.');
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'announcement.updated', entity: 'announcement', entityId: id, after: { title: i.title.trim() }, ip: c.ip, userAgent: c.userAgent });
}
