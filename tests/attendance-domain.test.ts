import { describe, expect, it } from 'vitest';
import {
  addDays, classifyClockIn, countDays, detectRosterConflicts, evaluateLocation, haversineM, impossibleTravel, localParts,
  toMin, workDateFor, type ShiftDef,
} from '../src/domain/attendance';

const HQ = { lat: 6.5244, lng: 3.3792, radiusM: 150 }; // Lagos
const near = (dLatM: number) => ({ lat: HQ.lat + dLatM / 111_320, lng: HQ.lng });

describe('geofence', () => {
  it('haversine is roughly right', () => expect(haversineM({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeGreaterThan(110_000));
  it('inside the radius', () => expect(evaluateLocation({ ...near(50), accuracyM: 10 }, HQ).status).toBe('inside'));
  it('outside the radius', () => expect(evaluateLocation({ ...near(2000), accuracyM: 10 }, HQ).status).toBe('outside'));
  it('uses accuracy as tolerance, but only up to the cap', () => {
    expect(evaluateLocation({ ...near(220), accuracyM: 80 }, HQ).status).toBe('inside');      // 150 + 80
    expect(evaluateLocation({ ...near(330), accuracyM: 500 }, HQ).status).toBe('unverifiable'); // cap 100 -> 250 < 330, but accuracy too poor to be sure
  });
  it('no location is unverifiable, not blocked', () => {
    expect(evaluateLocation(null, HQ)).toMatchObject({ status: 'unverifiable', reason: 'no_location' });
  });
  it('very poor accuracy but far away is still a definite outside', () => expect(evaluateLocation({ ...near(5000), accuracyM: 900 }, HQ).status).toBe('outside'));
});

describe('shift timing', () => {
  const day: ShiftDef = { startMin: toMin('08:00'), endMin: toMin('16:00'), graceMin: 10, earlyWindowMin: 60 };
  const night: ShiftDef = { startMin: toMin('22:00'), endMin: toMin('06:00'), graceMin: 10, earlyWindowMin: 60 };
  it('on time within grace, late after it', () => {
    expect(classifyClockIn(toMin('08:05'), day).status).toBe('on_time');
    expect(classifyClockIn(toMin('08:30'), day)).toEqual({ status: 'late', lateMinutes: 30 });
  });
  it('rejects clock-in too early and flags after-shift', () => {
    expect(classifyClockIn(toMin('06:00'), day).status).toBe('too_early');
    expect(classifyClockIn(toMin('17:00'), day).status).toBe('after_shift');
  });
  it('handles shifts crossing midnight (22:00 -> 06:00)', () => {
    expect(classifyClockIn(toMin('21:30'), night).status).toBe('on_time');
    expect(classifyClockIn(toMin('23:15'), night).status).toBe('late');
    expect(classifyClockIn(toMin('00:30'), night)).toMatchObject({ status: 'late', lateMinutes: 150 });
    expect(workDateFor({ date: '2026-03-02', minutes: toMin('01:00') }, night)).toBe('2026-03-01'); // belongs to the previous start date
    expect(workDateFor({ date: '2026-03-01', minutes: toMin('22:30') }, night)).toBe('2026-03-01');
  });
  it('reads local time in the workplace timezone', () => {
    expect(localParts(new Date('2026-03-01T22:30:00Z'), 'Africa/Lagos')).toEqual({ date: '2026-03-01', minutes: 23 * 60 + 30 });
    expect(localParts(new Date('2026-03-01T23:30:00Z'), 'Africa/Lagos')).toEqual({ date: '2026-03-02', minutes: 30 });
  });
  it('adds days across month ends', () => expect(addDays('2026-02-28', 1)).toBe('2026-03-01'));
});

describe('anomaly signals', () => {
  it('flags impossible travel but not normal movement', () => {
    const a = { lat: 6.5, lng: 3.4, at: new Date('2026-03-01T08:00:00Z') };
    expect(impossibleTravel(a, { lat: 9.07, lng: 7.4, at: new Date('2026-03-01T08:30:00Z') })).toBe(true); // Lagos -> Abuja in 30 min
    expect(impossibleTravel(a, { lat: 6.51, lng: 3.41, at: new Date('2026-03-01T08:30:00Z') })).toBe(false);
  });
});

describe('roster conflicts', () => {
  const day = { date: '2026-03-02', startMin: toMin('08:00'), endMin: toMin('16:00'), name: 'Day' };
  it('blocks overlapping shifts including across midnight', () => {
    const night = { date: '2026-03-01', startMin: toMin('22:00'), endMin: toMin('06:00'), name: 'Night' };
    const early = { date: '2026-03-02', startMin: toMin('02:00'), endMin: toMin('10:00'), name: 'Early' };
    expect(detectRosterConflicts([night], early).blocking.length).toBe(1); // night runs until 06:00 on the 2nd
  });
  it('warns on short rest between adjacent shifts', () => {
    const night = { date: '2026-03-01', startMin: toMin('22:00'), endMin: toMin('06:00'), name: 'Night' };
    const r = detectRosterConflicts([night], day);
    expect(r.blocking).toEqual([]);
    expect(r.warnings[0]).toMatch(/rest/);
  });
  it('blocks leave days and exact double booking', () => {
    expect(detectRosterConflicts([], day, { approvedLeave: [{ start: '2026-03-01', end: '2026-03-03' }] }).blocking[0]).toMatch(/leave/);
    expect(detectRosterConflicts([day], day).blocking[0]).toMatch(/Overlaps/);
  });
  it('counts working days', () => expect(countDays('2026-03-02', '2026-03-08')).toBe(5));
});
