import { beforeAll, describe, expect, it } from 'vitest';
import { privileged, withTenant } from '../src/server/db';
import { seedOrganization, TEMPLATES } from '../src/server/seed';
import { login } from '../src/server/auth';
import { runAs, UserError } from '../src/server/ctx';
import { ForbiddenError } from '../src/domain/policy';
import { assignmentOn, createEmployee, decideRegistration, getEmployee, listEmployees, listRegistrations, submitRegistration, transferEmployee } from '../src/server/hr';
import { publishDraft, resolveConfig, rollbackTo, saveDraft, configHistory } from '../src/server/config';
import { verifyAuditChain } from '../src/server/audit';

const creds: Record<string, string> = {};
const regIds = async () => withTenant(ids.prince897, async (q) => ({
  orgSlug: 'prince897', phone: '08030000000', birthDate: '1992-02-02', employmentType: 'permanent',
  departmentId: (await q.query<any>(`select id from departments where archived_at is null limit 1`))[0].id as string,
  branchId: (await q.query<any>(`select id from branches where archived_at is null limit 1`))[0].id as string,
  positionId: (await q.query<any>(`select id from positions where archived_at is null limit 1`))[0].id as string,
}));
const ids: Record<string, any> = {};

async function user(org: string, email: string) {
  const r = (await (await privileged()).query<any>('select u.id, u.org_id from users u join organizations o on o.id=u.org_id where o.slug=$1 and u.email=$2', [org, email]))[0];
  return r as { id: string; org_id: string };
}

beforeAll(async () => {
  const lines: string[] = [];
  for (const t of TEMPLATES) await seedOrganization(t, lines);
  for (const l of lines) { const [org, email, , pw] = l.split('\t'); creds[`${org}:${email}`] = pw; }
  for (const slug of ['prince897', 'gracechapel']) ids[slug] = (await (await privileged()).query<any>('select id from organizations where slug=$1', [slug]))[0].id;
});

describe('tenant isolation (database layer)', () => {
  it('RLS hides other tenants even with no WHERE clause', async () => {
    const a = await withTenant(ids.prince897, (q) => q.query<any>('select org_id from employees'));
    const b = await withTenant(ids.gracechapel, (q) => q.query<any>('select org_id from employees'));
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((r) => r.org_id === ids.prince897)).toBe(true);
    expect(b.every((r) => r.org_id === ids.gracechapel)).toBe(true);
  });
  it('cannot write a row for another tenant', async () => {
    await expect(withTenant(ids.gracechapel, (q) => q.query(`insert into departments (org_id, name) values ($1,'Smuggled')`, [ids.prince897]))).rejects.toThrow();
  });
  it('a tenant session with no tenant set sees nothing', async () => {
    const rows = await (await import('../src/server/db')).privileged().then(async (p) => {
      await p.query('begin'); await p.query('set local role app_user');
      const r = await p.query('select * from employees'); await p.query('rollback'); return r;
    });
    expect(rows.length).toBe(0);
  });
  it('rejects referencing another tenant\'s department (FKs bypass RLS, so the app re-checks)', async () => {
    const foreignDept = (await withTenant(ids.gracechapel, (q) => q.query<any>('select id from departments limit 1')))[0].id;
    const admin = await user('prince897', 'hr@prince897.example');
    await expect(runAs(ids.prince897, admin.id, (c) => createEmployee(c, { fullName: 'Mallory Test', email: 'm@x.example', departmentId: foreignDept }))).rejects.toThrow(/Unknown department/);
  });
  it('app role cannot alter or delete audit events', async () => {
    await expect(withTenant(ids.prince897, (q) => q.query('update audit_events set action = $1', ['x']))).rejects.toThrow();
    await expect(withTenant(ids.prince897, (q) => q.query('delete from audit_events'))).rejects.toThrow();
  });
});

describe('authentication', () => {
  it('logs in with correct details and rejects wrong ones with a generic message', async () => {
    const ok = await login('prince897', 'hr@prince897.example', creds['prince897:hr@prince897.example'], '10.0.0.1');
    expect(ok.ok).toBe(true);
    const bad = await login('prince897', 'hr@prince897.example', 'wrong-password-123', '10.0.0.2');
    const ghost = await login('prince897', 'nobody@prince897.example', 'wrong-password-123', '10.0.0.3');
    expect(bad).toEqual(ghost); // no user enumeration
  });
  it('cannot sign in to a different tenant with these credentials', async () => {
    const r = await login('gracechapel', 'hr@prince897.example', creds['prince897:hr@prince897.example'], '10.0.0.4');
    expect(r.ok).toBe(false);
  });
  it('locks after repeated failures', async () => {
    for (let i = 0; i < 5; i++) await login('prince897', 'chairman@prince897.example', 'bad-bad-bad-bad', '10.9.9.9');
    const r = await login('prince897', 'chairman@prince897.example', creds['prince897:chairman@prince897.example'], '10.9.9.8');
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/Too many/);
  });
});

describe('employee identity and history', () => {
  let empId = '', hr: { id: string };
  it('transfer keeps one identity and a queryable history', async () => {
    hr = await user('prince897', 'hr@prince897.example');
    const dept = await withTenant(ids.prince897, (q) => q.query<any>('select id, name from departments'));
    const news = dept.find((d) => d.name === 'News').id, prog = dept.find((d) => d.name === 'Programmes').id;
    const created = await runAs(ids.prince897, hr.id, (c) => createEmployee(c, { fullName: 'Employee A', email: 'a@prince897.example', departmentId: news, joinedOn: '2026-01-10' }));
    empId = created.id;
    await runAs(ids.prince897, hr.id, (c) => transferEmployee(c, { employeeId: empId, departmentId: prog, effectiveFrom: '2026-04-01', reason: 'Programme restructure' }));
    await withTenant(ids.prince897, async (q) => {
      expect((await assignmentOn(q, empId, '2026-03-15'))?.department).toBe('News');
      expect((await assignmentOn(q, empId, '2026-04-01'))?.department).toBe('Programmes');
      expect((await q.query<any>(`select count(*)::int c from employees where email = 'a@prince897.example'`))[0].c).toBe(1);
    });
    const view = await runAs(ids.prince897, hr.id, (c) => getEmployee(c, empId));
    expect(view!.employee.department).toBe('Programmes');
    expect(view!.history.map((h: any) => h.department)).toEqual(['Programmes', 'News']);
  });
  it('refuses duplicates, backdating before the current assignment and self-supervision', async () => {
    await expect(runAs(ids.prince897, hr.id, (c) => createEmployee(c, { fullName: 'Employee A again', email: 'a@prince897.example' }))).rejects.toBeInstanceOf(UserError);
    await expect(runAs(ids.prince897, hr.id, (c) => transferEmployee(c, { employeeId: empId, effectiveFrom: '2026-02-01', reason: 'x' }))).rejects.toThrow(/after the current assignment/);
    await expect(runAs(ids.prince897, hr.id, (c) => transferEmployee(c, { employeeId: empId, supervisorId: empId, effectiveFrom: '2026-06-01', reason: 'x' }))).rejects.toThrow(/supervise themselves/);
  });
  it('a plain employee can see only their own record and cannot transfer', async () => {
    const p = await user('prince897', 'presenter@prince897.example');
    await expect(runAs(ids.prince897, p.id, (c) => listEmployees(c))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runAs(ids.prince897, p.id, (c) => getEmployee(c, empId))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runAs(ids.prince897, p.id, (c) => transferEmployee(c, { employeeId: empId, effectiveFrom: '2026-08-01', reason: 'x' }))).rejects.toBeInstanceOf(ForbiddenError);
    const me = (await withTenant(ids.prince897, (q) => q.query<any>('select id from employees where user_id = $1', [p.id])))[0].id;
    await expect(runAs(ids.prince897, p.id, (c) => getEmployee(c, me))).resolves.toBeTruthy();
  });
  it('a person without transfer permission cannot transfer (the Administrator now holds it)', async () => {
    const a = await user('prince897', 'presenter@prince897.example');
    await expect(runAs(ids.prince897, a.id, (c) => transferEmployee(c, { employeeId: empId, effectiveFrom: '2026-09-01', reason: 'x' }))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('registration: requested authority is not actual authority', () => {
  it('cannot sign in until approved, and the reviewer decides the real assignment', async () => {
    const hr = await user('prince897', 'hr@prince897.example');
    const structure = await withTenant(ids.prince897, async (q) => ({
      dept: (await q.query<any>(`select id from departments where name = 'Finance'`))[0].id,
      news: (await q.query<any>(`select id from departments where name = 'News'`))[0].id,
      chairman: (await q.query<any>(`select id from positions where name = 'Chairman'`))[0].id,
      junior: (await q.query<any>(`select id from positions where name = 'Junior Staff'`))[0].id,
    }));
    await submitRegistration({ ...(await regIds()), fullName: 'Pending Person', username: 'pending.person', email: 'pending@prince897.example', password: 'a-long-unique-passphrase-9', departmentId: structure.dept, positionId: structure.chairman });
    expect((await login('prince897', 'pending@prince897.example', 'a-long-unique-passphrase-9')).ok).toBe(false);
    const [req] = await runAs(ids.prince897, hr.id, (c) => listRegistrations(c));
    await runAs(ids.prince897, hr.id, (c) => decideRegistration(c, { requestId: req.id, approve: true, departmentId: structure.news, positionId: structure.junior }));
    expect((await login('prince897', 'pending@prince897.example', 'a-long-unique-passphrase-9')).ok).toBe(true);
    const e = (await withTenant(ids.prince897, (q) => q.query<any>(`select e.id from employees e where email = 'pending@prince897.example'`)))[0].id;
    const cur = await withTenant(ids.prince897, (q) => assignmentOn(q, e, new Date().toISOString().slice(0, 10)));
    expect(cur?.position).toBe('Junior Staff'); // not the requested Chairman
    expect(cur?.department).toBe('News');
  });
  it('rejects weak passwords and cannot grant elevated roles without role:manage', async () => {
    await expect(submitRegistration({ ...(await regIds()), fullName: 'Weak', username: 'weak.user', email: 'weak@x.example', password: 'short' })).rejects.toThrow(/12 characters/);
    const hr = await user('prince897', 'hr@prince897.example');
    await submitRegistration({ ...(await regIds()), fullName: 'Escalator', username: 'escalator', email: 'esc@prince897.example', password: 'another-long-passphrase-7' });
    const [req] = await runAs(ids.prince897, hr.id, (c) => listRegistrations(c));
    await expect(runAs(ids.prince897, hr.id, (c) => decideRegistration(c, { requestId: req.id, approve: true, roleKey: 'tenant_admin' }))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('configuration: draft, publish, rollback, relabel', () => {
  it('publishes branding and terminology per tenant without code changes and can roll back', async () => {
    const admin = await user('prince897', 'admin@prince897.example');
    const before = await withTenant(ids.prince897, (q) => resolveConfig(q));
    await runAs(ids.prince897, admin.id, async (c) => {
      await saveDraft(c, 'branding', { ...before.branding, name: 'Prince Media Group', primary: '#1D4ED8' });
      await publishDraft(c, 'branding', 'Rebrand');
    });
    expect((await withTenant(ids.prince897, (q) => resolveConfig(q))).branding.name).toBe('Prince Media Group');
    expect((await withTenant(ids.gracechapel, (q) => resolveConfig(q))).branding.name).toBe('Grace Chapel'); // other tenant untouched
    expect((await withTenant(ids.gracechapel, (q) => resolveConfig(q))).terms.department.plural).toBe('Ministries');
    const hist = await withTenant(ids.prince897, (q) => configHistory(q, 'branding'));
    const v1 = hist.find((h: any) => h.version === 1);
    await runAs(ids.prince897, admin.id, (c) => rollbackTo(c, 'branding', v1.id, 'Reverting trial'));
    expect((await withTenant(ids.prince897, (q) => resolveConfig(q))).branding.name).toBe('PRINCE 89.7 FM');
  });
  it('rejects low-contrast colours and invalid payloads', async () => {
    const admin = await user('prince897', 'admin@prince897.example');
    const b = (await withTenant(ids.prince897, (q) => resolveConfig(q))).branding;
    await expect(runAs(ids.prince897, admin.id, async (c) => { await saveDraft(c, 'branding', { ...b, primary: '#FFFF00' }); })).rejects.toThrow(/contrast/);
    await expect(runAs(ids.prince897, admin.id, async (c) => { await saveDraft(c, 'branding', { ...b, primary: 'red' }); })).rejects.toThrow();
  });
  it('non-admins cannot change configuration', async () => {
    const p = await user('prince897', 'presenter@prince897.example');
    const b = (await withTenant(ids.prince897, (q) => resolveConfig(q))).branding;
    await expect(runAs(ids.prince897, p.id, async (c) => { await saveDraft(c, 'branding', b); })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('audit trail', () => {
  it('is hash-chained and detects tampering', async () => {
    expect(await withTenant(ids.prince897, (q) => verifyAuditChain(q, ids.prince897))).toBeNull();
    const p = await privileged();
    const row = (await p.query<any>(`select id from audit_events where org_id = $1 order by id limit 1 offset 2`, [ids.prince897]))[0];
    await p.query(`update audit_events set reason = 'tampered' where id = $1`, [row.id]);
    expect(await withTenant(ids.prince897, (q) => verifyAuditChain(q, ids.prince897))).toBe(Number(row.id));
  });
});
