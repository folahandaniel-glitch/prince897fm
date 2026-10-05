/** Pure reporting rules: reporting periods, deadlines in the organisation's timezone, and approval-chain authority. */
import { addDays } from './attendance';
import type { Subject } from './policy';

export type Cadence = 'weekly' | 'monthly';
export interface Period { start: string; end: string; dueDate: string }

const dow = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday

export function lastDayOfMonth(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Weekly period = Monday..Sunday containing `localDate`; the deadline is `dueWeekday` of that week (default Friday). */
export function periodFor(cadence: Cadence, localDate: string, dueWeekday = 5): Period {
  if (cadence === 'monthly') {
    const [y, m] = localDate.split('-');
    const end = lastDayOfMonth(localDate);
    return { start: `${y}-${m}-01`, end, dueDate: end };
  }
  const fromMonday = (dow(localDate) + 6) % 7;
  const start = addDays(localDate, -fromMonday);
  const offset = (dueWeekday + 6) % 7; // Monday = 0
  return { start, end: addDays(start, 6), dueDate: addDays(start, offset) };
}

function tzOffsetMs(utcMs: number, tz: string): number {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `tz` reads `date` `hhmm` (handles daylight saving). */
export function zonedToUtc(date: string, hhmm: string, tz: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wall - tzOffsetMs(wall, tz);
  guess = wall - tzOffsetMs(guess, tz); // second pass settles instants near a DST change
  return new Date(guess);
}

export const dueInstant = (p: Period, dueTime: string, tz: string) => zonedToUtc(p.dueDate, dueTime.slice(0, 5), tz);

export type ChainStep = { kind: 'supervisor' } | { kind: 'role'; roleKey: string };

export interface ReportContext { supervisorUserId: string | null; supervisorEmployeeId: string | null; departmentId: string | null }

/**
 * May this person act on this approval step? Supervisor steps belong to the supervisor recorded when the report
 * was submitted; role steps belong to holders of that role (active today, and in scope of the report's department).
 */
export function canActOnStep(step: ChainStep, who: Subject, ctx: ReportContext, now = new Date().toISOString().slice(0, 10)): boolean {
  if (step.kind === 'supervisor') return !!ctx.supervisorEmployeeId && who.employeeId === ctx.supervisorEmployeeId;
  return who.grants.some((g) => g.roleKey === step.roleKey && g.validFrom <= now && (!g.validTo || g.validTo >= now)
    && (!g.departmentIds || !ctx.departmentId || g.departmentIds.includes(ctx.departmentId)));
}

/** Next step index at or after `from` that is actually staffed; supervisor steps with no supervisor are skipped. */
export function nextStep(chain: ChainStep[], from: number, ctx: ReportContext): number {
  let i = from;
  while (i < chain.length && chain[i].kind === 'supervisor' && !ctx.supervisorEmployeeId) i++;
  return i;
}

export function reportState(r: { status: string; dueAt: Date | string }, now = new Date()): 'open' | 'due_soon' | 'overdue' | 'done' {
  if (['submitted', 'under_review', 'approved'].includes(r.status)) return 'done';
  const due = new Date(r.dueAt).getTime();
  if (now.getTime() > due) return 'overdue';
  return due - now.getTime() < 24 * 3_600_000 ? 'due_soon' : 'open';
}
