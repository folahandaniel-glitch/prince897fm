import { describe, expect, it } from 'vitest';
import { can, violatesSeparation, type Subject } from '../src/domain/policy';
import { contrastRatio, resolveLabel, DEFAULT_TERMS } from '../src/domain/config-schema';

const subj = (grants: Subject['grants'], extra: Partial<Subject> = {}): Subject => ({ userId: 'u1', orgId: 'o1', employeeId: 'e1', grants, ...extra });
const g = (permissions: string[], over: Partial<Subject['grants'][0]> = {}) => ({ roleKey: 'r', permissions, departmentIds: null, branchIds: null, validFrom: '2020-01-01', validTo: null, ...over });

describe('policy engine', () => {
  it('denies by default', () => expect(can(subj([]), 'employee:view').allow).toBe(false));
  it('allows exact, resource wildcard and global wildcard', () => {
    expect(can(subj([g(['employee:view'])]), 'employee:view').allow).toBe(true);
    expect(can(subj([g(['employee:*'])]), 'employee:transfer').allow).toBe(true);
    expect(can(subj([g(['*'])]), 'finance:pay').allow).toBe(true);
    expect(can(subj([g(['employee:view'])]), 'employee:transfer').allow).toBe(false);
  });
  it('never crosses organisations', () => expect(can(subj([g(['*'])]), 'employee:view', { orgId: 'other' }).allow).toBe(false));
  it(':own only matches the caller\'s own records', () => {
    const s = subj([g(['employee:view:own'])]);
    expect(can(s, 'employee:view', { ownerEmployeeId: 'e1' }).allow).toBe(true);
    expect(can(s, 'employee:view', { ownerEmployeeId: 'e2' }).allow).toBe(false);
  });
  it('enforces department and branch scope (ABAC)', () => {
    const s = subj([g(['employee:view'], { departmentIds: ['d1'] })]);
    expect(can(s, 'employee:view', { departmentId: 'd1' }).allow).toBe(true);
    expect(can(s, 'employee:view', { departmentId: 'd2' }).allow).toBe(false);
    const b = subj([g(['employee:view'], { branchIds: ['b1'] })]);
    expect(can(b, 'employee:view', { branchId: 'b2' }).allow).toBe(false);
  });
  it('honours the effective period of temporary / acting authority', () => {
    const s = subj([g(['employee:transfer'], { validFrom: '2026-03-01', validTo: '2026-03-31' })]);
    expect(can(s, 'employee:transfer', {}, '2026-03-15').allow).toBe(true);
    expect(can(s, 'employee:transfer', {}, '2026-04-01').allow).toBe(false);
    expect(can(s, 'employee:transfer', {}, '2026-02-28').allow).toBe(false);
  });
  it('detects separation-of-duties violations', () => {
    expect(violatesSeparation('u1', { created: 'u1' }, ['created'])).toMatch(/Separation of duties/);
    expect(violatesSeparation('u2', { created: 'u1' }, ['created'])).toBeNull();
  });
});

describe('terminology and colour guards', () => {
  it('relabels without changing identifiers', () => {
    const terms = { ...DEFAULT_TERMS, department: { singular: 'Ministry', plural: 'Ministries' } };
    expect(resolveLabel('{department.plural}', terms)).toBe('Ministries');
    expect(resolveLabel('{employee.plural}', terms)).toBe('Employees');
  });
  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#12284C', '#ffffff')).toBeGreaterThan(4.5);
    expect(contrastRatio('#ffff00', '#ffffff')).toBeLessThan(2);
  });
});
