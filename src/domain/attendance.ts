/**
 * Pure attendance logic: geofence evaluation, shift timing (including shifts that cross midnight), roster conflict
 * detection and anomaly signals. No I/O, so every rule is unit-tested.
 *
 * Design stance: browser location is a *risk signal*, not proof. Accuracy widens the allowed distance (up to a cap),
 * very poor accuracy yields "unverifiable" (an exception path, never a silent failure), and anomalies raise review
 * flags instead of punishing anyone automatically.
 */

export interface Point { lat: number; lng: number }
export interface Reported extends Point { accuracyM?: number | null }

export function haversineM(a: Point, b: Point): number {
  const R = 6371008.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface LocationVerdict {
  status: 'inside' | 'outside' | 'unverifiable';
  distanceM: number | null;
  reason?: 'no_location' | 'low_accuracy';
}

export function evaluateLocation(
  reported: Reported | null | undefined,
  wp: Point & { radiusM: number },
  opts: { accuracyCapM?: number; maxUsableAccuracyM?: number } = {},
): LocationVerdict {
  const cap = opts.accuracyCapM ?? 100;
  const maxUsable = opts.maxUsableAccuracyM ?? 300;
  if (!reported || !Number.isFinite(reported.lat) || !Number.isFinite(reported.lng)) return { status: 'unverifiable', distanceM: null, reason: 'no_location' };
  const distanceM = Math.round(haversineM(reported, wp));
  const acc = reported.accuracyM ?? 0;
  const tolerance = Math.min(Math.max(acc, 0), cap);
  if (distanceM <= wp.radiusM + tolerance) return { status: 'inside', distanceM };
  // Clearly outside even after the most generous tolerance: a definite answer despite poor accuracy.
  if (distanceM > wp.radiusM + maxUsable) return { status: 'outside', distanceM };
  if (acc > maxUsable) return { status: 'unverifiable', distanceM, reason: 'low_accuracy' };
  return { status: 'outside', distanceM };
}

// ---- Time ------------------------------------------------------------------------------------------------
export const toMin = (t: string): number => { const [h, m] = t.split(':'); return Number(h) * 60 + Number(m); };

export function localParts(d: Date, tz: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};

export interface ShiftDef { startMin: number; endMin: number; graceMin: number; earlyWindowMin: number }

export const isOvernight = (s: ShiftDef) => s.endMin <= s.startMin;
export const shiftLengthMin = (s: ShiftDef) => ((s.endMin - s.startMin + 1440) % 1440) || 1440;

/** Which calendar date a clock event belongs to: the shift's *start* date, so 22:00-06:00 stays one record. */
export function workDateFor(local: { date: string; minutes: number }, s: ShiftDef): string {
  return isOvernight(s) && local.minutes < s.endMin ? addDays(local.date, -1) : local.date;
}

export type ClockTiming =
  | { status: 'too_early'; lateMinutes: 0; minutesUntilWindow: number }
  | { status: 'on_time'; lateMinutes: 0 }
  | { status: 'late'; lateMinutes: number }
  | { status: 'after_shift'; lateMinutes: number };

export function classifyClockIn(localMinutes: number, s: ShiftDef): ClockTiming {
  // signed distance from shift start on a circular day, in [-720, 720)
  const delta = ((localMinutes - s.startMin + 720 + 1440) % 1440) - 720;
  if (delta < -s.earlyWindowMin) return { status: 'too_early', lateMinutes: 0, minutesUntilWindow: -delta - s.earlyWindowMin };
  if (delta <= s.graceMin) return { status: 'on_time', lateMinutes: 0 };
  if (delta > shiftLengthMin(s)) return { status: 'after_shift', lateMinutes: delta };
  return { status: 'late', lateMinutes: delta };
}

// ---- Anomaly signals (advisory) --------------------------------------------------------------------------------
export function impossibleTravel(prev: Point & { at: Date }, cur: Point & { at: Date }, maxKmh = 250): boolean {
  const km = haversineM(prev, cur) / 1000;
  const hours = Math.max((cur.at.getTime() - prev.at.getTime()) / 3_600_000, 1 / 3600);
  return km > 5 && km / hours > maxKmh;
}

// ---- Roster conflicts ------------------------------------------------------------------------------------------
export interface RosterShift { date: string; startMin: number; endMin: number; name?: string }
const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
export function interval(r: RosterShift): [number, number] {
  const start = dayNumber(r.date) * 1440 + r.startMin;
  const len = ((r.endMin - r.startMin + 1440) % 1440) || 1440;
  return [start, start + len];
}

export interface ConflictReport { blocking: string[]; warnings: string[] }

export function detectRosterConflicts(
  existing: RosterShift[], candidate: RosterShift,
  opts: { minRestHours?: number; approvedLeave?: { start: string; end: string }[] } = {},
): ConflictReport {
  const out: ConflictReport = { blocking: [], warnings: [] };
  const [cs, ce] = interval(candidate);
  const minRest = (opts.minRestHours ?? 11) * 60;
  for (const e of existing) {
    const [es, ee] = interval(e);
    if (cs < ee && es < ce) out.blocking.push(`Overlaps ${e.name ?? 'another shift'} on ${e.date}.`);
    else {
      const gap = cs >= ee ? cs - ee : es - ce;
      if (gap < minRest) out.warnings.push(`Only ${Math.round(gap / 60 * 10) / 10}h rest around ${e.name ?? 'the adjacent shift'} on ${e.date} (policy ${opts.minRestHours ?? 11}h).`);
    }
  }
  for (const l of opts.approvedLeave ?? []) if (candidate.date >= l.start && candidate.date <= l.end) out.blocking.push(`Employee is on approved leave on ${candidate.date}.`);
  return out;
}

/** Inclusive count of days between two ISO dates, excluding weekends when requested. */
export function countDays(start: string, end: string, excludeWeekends = true): number {
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (!excludeWeekends || (dow !== 0 && dow !== 6)) n++;
  }
  return n;
}
