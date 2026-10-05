import { describe, expect, it } from 'vitest';
import { canActOnStep, dueInstant, lastDayOfMonth, nextStep, periodFor, reportState, zonedToUtc } from '../src/domain/reports';
import type { Subject } from '../src/domain/policy';

describe('periods and deadlines', () => {
  it('weekly period is Monday-Sunday and due Friday', () => {
    expect(periodFor('weekly', '2026-10-07')).toEqual({ start: '2026-10-05', end: '2026-10-11', dueDate: '2026-10-09' }); // Wed -> Fri 9th
    expect(periodFor('weekly', '2026-10-11').start).toBe('2026-10-05'); // Sunday belongs to the week that began Monday
    expect(periodFor('weekly', '2026-10-05').dueDate).toBe('2026-10-09');
  });
  it('monthly is due on the last day, including leap years', () => {
    expect(periodFor('monthly', '2028-02-10')).toEqual({ start: '2028-02-01', end: '2028-02-29', dueDate: '2028-02-29' });
    expect(lastDayOfMonth('2026-04-03')).toBe('2026-04-30');
  });
  it('18:00 in Lagos is 17:00 UTC (no daylight saving)', () => {
    expect(dueInstant(periodFor('weekly', '2026-10-07'), '18:00', 'Africa/Lagos').toISOString()).toBe('2026-10-09T17:00:00.000Z');
  });
  it('handles daylight saving elsewhere (configurable timezones)', () => {
    expect(zonedToUtc('2026-07-01', '18:00', 'America/New_York').toISOString()).toBe('2026-07-01T22:00:00.000Z'); // EDT
    expect(zonedToUtc('2026-12-01', '18:00', 'America/New_York').toISOString()).toBe('2026-12-01T23:00:00.000Z'); // EST
  });
  it('classifies report state', () => {
    const now = new Date('2026-10-09T10:00:00Z');
    expect(reportState({ status: 'draft', dueAt: '2026-10-09T17:00:00Z' }, now)).toBe('due_soon');
    expect(reportState({ status: 'draft', dueAt: '2026-10-09T09:00:00Z' }, now)).toBe('overdue');
    expect(reportState({ status: 'submitted', dueAt: '2026-10-01T09:00:00Z' }, now)).toBe('done');
    expect(reportState({ status: 'draft', dueAt: '2026-10-20T09:00:00Z' }, now)).toBe('open');
  });
});

describe('approval chain authority', () => {
  const who = (over: Partial<Subject> = {}): Subject => ({ userId: 'u', orgId: 'o', employeeId: 'e1', grants: [], ...over });
  const grant = (roleKey: string, extra = {}) => ({ roleKey, permissions: [], departmentIds: null, branchIds: null, validFrom: '2020-01-01', validTo: null, ...extra });
  const ctx = { supervisorUserId: 'su', supervisorEmployeeId: 'sup', departmentId: 'dNews' };
  it('supervisor step is only for the supervisor recorded at submission', () => {
    expect(canActOnStep({ kind: 'supervisor' }, who({ employeeId: 'sup' }), ctx)).toBe(true);
    expect(canActOnStep({ kind: 'supervisor' }, who({ employeeId: 'other' }), ctx)).toBe(false);
  });
  it('role step requires the role, in scope, and in effect', () => {
    const step = { kind: 'role', roleKey: 'department_head' } as const;
    expect(canActOnStep(step, who({ grants: [grant('department_head')] }), ctx)).toBe(true);
    expect(canActOnStep(step, who({ grants: [grant('department_head', { departmentIds: ['dSport'] })] }), ctx)).toBe(false);
    expect(canActOnStep(step, who({ grants: [grant('department_head', { validTo: '2025-01-01' })] }), ctx)).toBe(false);
    expect(canActOnStep(step, who({ grants: [grant('employee')] }), ctx)).toBe(false);
  });
  it('skips a supervisor step when nobody is assigned', () => {
    const chain = [{ kind: 'supervisor' }, { kind: 'role', roleKey: 'executive' }] as const;
    expect(nextStep([...chain], 0, { ...ctx, supervisorEmployeeId: null })).toBe(1);
    expect(nextStep([...chain], 0, ctx)).toBe(0);
  });
});
