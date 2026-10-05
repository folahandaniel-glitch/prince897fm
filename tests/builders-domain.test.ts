import { describe, expect, it } from 'vitest';
import { allowedNext, canTransition, fillTemplate, hasAccess, matches, safeHref, slug, validateBlocks, validateEntity, validateRecord, type EntityDef, type FieldDef } from '../src/domain/builders';

const roles = new Set(['hr_manager', 'executive', 'employee']);
const def: EntityDef = {
  key: 'pastoral_care', name: 'Pastoral Care', plural: 'Pastoral Care visits', prefix: 'PC',
  fields: [{ key: 'member', label: 'Member', type: 'text', required: true }, { key: 'visit_date', label: 'Visit date', type: 'date', required: true }, { key: 'kind', label: 'Kind', type: 'select', required: true, options: ['Home', 'Hospital'] }],
  statuses: [{ key: 'new', label: 'New' }, { key: 'in_progress', label: 'In progress' }, { key: 'done', label: 'Done' }],
  transitions: [{ from: 'new', to: 'in_progress', roles: [] }, { from: 'in_progress', to: 'done', roles: ['hr_manager'] }],
  access: { view: ['*'], create: ['hr_manager'], edit: ['hr_manager'], remove: ['executive'] },
};

describe('entity definitions', () => {
  it('accepts a good definition', () => expect(validateEntity(def, roles)).toEqual([]));
  it('rejects bad keys, prefixes, duplicate fields, missing options, unknown statuses and roles', () => {
    const bad: EntityDef = { ...def, key: 'Bad Key', prefix: 'x', fields: [{ key: 'a', label: 'A', type: 'select', required: false, options: ['only'] }, { key: 'a', label: 'A2', type: 'text', required: false }], transitions: [{ from: 'new', to: 'ghost', roles: ['nope'] }], access: { ...def.access, view: ['alien'] } };
    const e = validateEntity(bad, roles).join(' | ');
    for (const w of ['key must be', 'prefix', 'share the key', 'two options', 'unknown status', 'Unknown role']) expect(e).toContain(w);
  });
  it('slugifies', () => expect(slug('Patient Services (OPD)!')).toBe('patient_services_opd'));
});

describe('record validation', () => {
  const f: FieldDef[] = [
    { key: 'name', label: 'Name', type: 'text', required: true }, { key: 'amount', label: 'Amount', type: 'currency', required: false }, { key: 'when', label: 'When', type: 'date', required: false },
    { key: 'kind', label: 'Kind', type: 'select', required: false, options: ['A', 'B'] }, { key: 'tags', label: 'Tags', type: 'multiselect', required: false, options: ['x', 'y'] },
    { key: 'mail', label: 'Mail', type: 'email', required: false }, { key: 'ok', label: 'OK', type: 'boolean', required: false }, { key: 'old', label: 'Old', type: 'text', required: true, archived: true },
  ];
  it('normalises valid input and ignores unknown or archived fields', () => {
    const r = validateRecord(f, { name: ' Ada ', amount: '2,500.50', when: '2026-05-01', kind: 'A', tags: 'x, y', mail: 'ADA@X.COM', ok: 'on', hacker: '<script>', old: '' });
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ name: 'Ada', amount: 2500.5, when: '2026-05-01', kind: 'A', tags: ['x', 'y'], mail: 'ada@x.com', ok: true });
  });
  it('reports every problem in plain language', () => {
    const r = validateRecord(f, { amount: '12.345', when: '2026-13-45', kind: 'Z', tags: 'q', mail: 'nope' });
    expect(Object.keys(r.errors).sort()).toEqual(['amount', 'kind', 'mail', 'name', 'tags', 'when']);
  });
});

describe('workflow', () => {
  it('only allows configured moves by permitted roles', () => {
    expect(canTransition(def, 'new', 'in_progress', ['employee'])).toEqual({ ok: true });
    expect(canTransition(def, 'new', 'done', ['hr_manager']).ok).toBe(false);
    expect(canTransition(def, 'in_progress', 'done', ['employee']).ok).toBe(false);
    expect(canTransition(def, 'in_progress', 'done', ['hr_manager']).ok).toBe(true);
    expect(canTransition(def, 'new', 'new', []).ok).toBe(false);
    expect(allowedNext(def, 'in_progress', ['employee'])).toEqual([]);
  });
  it('access lists support the wildcard', () => {
    expect(hasAccess(['*'], [])).toBe(true);
    expect(hasAccess(['hr_manager'], ['employee'])).toBe(false);
  });
});

describe('automation conditions', () => {
  const data = { amount: 750000, kind: 'Hospital', tags: ['x', 'y'] };
  it('compares with fixed operators only', () => {
    expect(matches([{ field: 'amount', op: 'gt', value: '500000' }], data)).toBe(true);
    expect(matches([{ field: 'amount', op: 'lte', value: '500000' }], data)).toBe(false);
    expect(matches([{ field: 'kind', op: 'in', value: 'Home, Hospital' }], data)).toBe(true);
    expect(matches([{ field: 'tags', op: 'contains', value: 'Y' }], data)).toBe(true);
    expect(matches([{ field: '_status', op: 'eq', value: 'done' }], data, 'done')).toBe(true);
    expect(matches([{ field: 'missing', op: 'gt', value: '1' }], data)).toBe(false);
    expect(matches([], data)).toBe(true);
  });
  it('interpolates placeholders as plain text without evaluating anything', () => {
    expect(fillTemplate('New {kind} case worth {amount} by {who}', data, { who: 'Ada' })).toBe('New Hospital case worth 750000 by Ada');
    expect(fillTemplate('{constructor} {__proto__}', data)).toBe(' ');
  });
});

describe('custom page blocks', () => {
  it('allows site paths and https only', () => {
    expect(safeHref('/tasks')).toBe(true); expect(safeHref('https://example.com/a')).toBe(true);
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//evil.com', 'http://insecure.com', ' /x']) expect(safeHref(bad)).toBe(false);
    expect(validateBlocks([{ type: 'button', label: 'Go', href: 'javascript:alert(1)' }]).length).toBe(1);
    expect(validateBlocks([{ type: 'heading', text: 'Hi' }, { type: 'button', label: 'Go', href: '/tasks' }])).toEqual([]);
  });
});
