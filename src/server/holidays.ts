import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export const listHolidays = (c: Ctx, year: number) => c.q.query<any>(`select id, holiday_date::text as d, name from public_holidays where extract(year from holiday_date) = $1 order by holiday_date`, [year]);

export async function addHoliday(c: Ctx, date: string, name: string) {
  need(c, 'leave:manage');
  if (!isDate(date)) throw new UserError('Enter a valid date.');
  if (name.trim().length < 2) throw new UserError('Enter the holiday name.');
  const r = await c.q.query(`insert into public_holidays (org_id, holiday_date, name) values ($1,$2,$3) on conflict (org_id, holiday_date) do nothing returning id`, [c.orgId, date, name.trim()]);
  if (!r[0]) throw new UserError('That date is already listed.');
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'leave.holiday_added', entity: 'public_holiday', entityId: date, after: { name: name.trim() }, ip: c.ip, userAgent: c.userAgent });
}

export async function removeHoliday(c: Ctx, id: string) {
  need(c, 'leave:manage');
  const r = await c.q.query<any>('delete from public_holidays where id = $1 returning holiday_date::text as d, name', [id]);
  if (r[0]) await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'leave.holiday_removed', entity: 'public_holiday', entityId: r[0].d, before: { name: r[0].name }, ip: c.ip, userAgent: c.userAgent });
}

/** Fixed-date Nigerian public holidays. Moveable ones (Good Friday, Easter Monday, Eid, Mawlid) change yearly and must be added by hand; verify against the official gazette. */
export const FIXED_NG: [string, string][] = [['01-01', "New Year's Day"], ['05-01', "Workers' Day"], ['05-29', 'Democracy Day'], ['10-01', 'Independence Day'], ['12-25', 'Christmas Day'], ['12-26', 'Boxing Day']];

export async function addFixedHolidays(c: Ctx, year: number) {
  need(c, 'leave:manage');
  if (!(year >= 2020 && year <= 2100)) throw new UserError('Enter a valid year.');
  let n = 0;
  for (const [md, name] of FIXED_NG) {
    const r = await c.q.query(`insert into public_holidays (org_id, holiday_date, name) values ($1,$2,$3) on conflict (org_id, holiday_date) do nothing returning id`, [c.orgId, `${year}-${md}`, name]);
    if (r[0]) n++;
  }
  return n;
}
