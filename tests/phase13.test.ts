import { beforeAll, describe, expect, it } from 'vitest';
import { privileged, withTenant } from '../src/server/db';
import { seedOrganization, TEMPLATES } from '../src/server/seed';
import { runAs } from '../src/server/ctx';
import { ADMIN_EXCLUDED, can, ForbiddenError, SYSTEM_ROLES } from '../src/domain/policy';
import { decideRegistration, listRegistrations, submitRegistration } from '../src/server/hr';
import { login } from '../src/server/auth';
import { createUser } from '../src/server/backend';
import { moderate, recentActivity } from '../src/server/oversight';

const ids: Record<string, string> = {};
const u: Record<string, string> = {};
const as = <T>(who: string, fn: Parameters<typeof runAs<T>>[2]) => runAs(ids.org, u[who], fn);

beforeAll(async () => {
  for (const t of TEMPLATES) await seedOrganization(t, []);
  const p = await privileged();
  ids.org = (await p.query<any>(`select id from organizations where slug = 'prince897'`))[0].id;
  for (const [k, e] of Object.entries({ admin: 'admin', hr: 'hr', superadmin: 'superadmin', presenter: 'presenter', sales: 'sales', chairman: 'chairman' })) u[k] = (await p.query<any>(`select id from users where org_id = $1 and email = $2`, [ids.org, `${e}@prince897.example`]))[0].id;
  ids.dept = (await p.query<any>(`select id from departments where org_id = $1 and archived_at is null order by name limit 1`, [ids.org]))[0].id;
  ids.branch = (await p.query<any>(`select id from branches where org_id = $1 and archived_at is null limit 1`, [ids.org]))[0].id;
  ids.pos = (await p.query<any>(`select id from positions where org_id = $1 and archived_at is null order by rank_level desc limit 1`, [ids.org]))[0].id;
});

const good = () => ({ orgSlug: 'prince897', fullName: 'Ada Okafor', username: 'ada.okafor', email: 'ada@prince897.example', phone: '0803 123 4567', birthDate: '1995-06-15', password: 'a-long-passphrase-for-ada-1', departmentId: ids.dept, branchId: ids.branch, positionId: ids.pos, employmentType: 'permanent' });

describe('staff registration: every detail is compulsory', () => {
  it('refuses a form with anything missing or invalid, in plain words', async () => {
    const cases: [Partial<ReturnType<typeof good>>, RegExp][] = [
      [{ fullName: ' ' }, /full name/], [{ username: '' }, /username/], [{ username: 'a b' }, /username/], [{ username: 'ab' }, /username/], [{ email: 'nope' }, /email/],
      [{ phone: '' }, /phone/], [{ phone: 'abc' }, /phone/], [{ birthDate: '' }, /date of birth/], [{ birthDate: '2999-01-01' }, /date of birth/], [{ password: 'short' }, /12 characters/],
      [{ departmentId: '' }, /department, branch and position/], [{ branchId: '' }, /department, branch and position/], [{ positionId: '' }, /department, branch and position/], [{ employmentType: '' }, /employment type/], [{ employmentType: 'wizard' }, /employment type/],
    ];
    for (const [patch, msg] of cases) await expect(submitRegistration({ ...good(), ...patch })).rejects.toThrow(msg);
    expect(await withTenant(ids.org, (q) => q.query(`select 1 from registration_requests where username = 'ada.okafor'`))).toHaveLength(0);
  });

  it('accepts a complete form and refuses a duplicate username or email', async () => {
    await submitRegistration(good());
    await expect(submitRegistration({ ...good(), email: 'other@prince897.example' })).rejects.toThrow(/username is already taken/);
    await expect(submitRegistration({ ...good(), username: 'ada2' })).rejects.toThrow(/already exists for this email/);
    await expect(submitRegistration({ ...good(), username: 'admin@prince897.example'.slice(0, 5), email: 'x@prince897.example' }).catch((e) => { throw e; })).resolves.toBeUndefined(); // "admin" is free as a username: only real usernames/emails collide
  });

  it('can be approved by the Administrator, HR, the Super Admin or any staff member given the approver role, and by nobody else', async () => {
    const pending = await as('hr', (c) => listRegistrations(c));
    expect(pending.length).toBe(2);
    const first = pending.find((r: any) => r.username === 'ada.okafor')!;
    expect(first).toMatchObject({ full_name: 'Ada Okafor', requested_employment_type: 'permanent' });
    await expect(as('presenter', (c) => listRegistrations(c))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('presenter', (c) => decideRegistration(c, { requestId: first.id, approve: true }))).rejects.toBeInstanceOf(ForbiddenError);
    // a staff member is made an approver by giving them the role
    await as('admin', (c) => createUser(c, { email: 'approver@prince897.example', fullName: 'Helpful Approver', roleKey: 'registration_approver' }));
    const approver = (await (await privileged()).query<any>(`select id from users where email = 'approver@prince897.example'`))[0].id;
    u.approver = approver;
    expect((await as('approver', (c) => listRegistrations(c))).length).toBe(2);
    await as('approver', (c) => decideRegistration(c, { requestId: first.id, approve: true, departmentId: ids.dept, branchId: ids.branch, positionId: ids.pos }));
    const second = pending.find((r: any) => r.id !== first.id)!;
    await as('admin', (c) => decideRegistration(c, { requestId: second.id, approve: false, reason: 'Duplicate request' }));
    // approver cannot hand out powerful roles
    await submitRegistration({ ...good(), username: 'bola.k', email: 'bola@prince897.example', fullName: 'Bola Kuti' });
    const third = (await as('superadmin', (c) => listRegistrations(c)))[0];
    await expect(as('approver', (c) => decideRegistration(c, { requestId: third.id, approve: true, roleKey: 'tenant_admin' }))).rejects.toBeInstanceOf(ForbiddenError);
    await as('superadmin', (c) => decideRegistration(c, { requestId: third.id, approve: true, departmentId: ids.dept, branchId: ids.branch, positionId: ids.pos }));
  });

  it('gives the new person a working account: sign in by username or email, with their date of birth recorded', async () => {
    expect((await login('prince897', 'ada.okafor', 'a-long-passphrase-for-ada-1')).ok).toBe(true);
    expect((await login('prince897', 'ADA@prince897.example', 'a-long-passphrase-for-ada-1')).ok).toBe(true);
    expect((await login('prince897', 'ada.okafor', 'wrong-passphrase-here-1')).ok).toBe(false);
    const e = (await (await privileged()).query<any>(`select birth_date::text b, phone, employment_type from employees where email = 'ada@prince897.example'`))[0];
    expect(e).toEqual({ b: '1995-06-15', phone: '08031234567', employment_type: 'permanent' });
  });
});

describe('the Administrator controls everything except the Chairman\'s approvals and the BackEnd', () => {
  it('holds every tenant permission apart from the excluded ones', () => {
    const admin = SYSTEM_ROLES.find((r) => r.key === 'tenant_admin')!.permissions;
    const wanted = ['finance:create', 'finance:pay', 'finance:reconcile', 'payroll:manage', 'payroll:configure', 'crm:manage', 'discipline:raise', 'discipline:manage', 'report:review', 'kpi:manage', 'assessment:manage', 'admin:control', 'role:manage', 'registration:review', 'employee:edit', 'doc:manage', 'ticket:manage', 'leave:review', 'roster:manage'];
    for (const w of wanted) expect(admin, w).toContain(w);
    for (const x of ADMIN_EXCLUDED) expect(admin, x).not.toContain(x);
    expect(SYSTEM_ROLES.find((r) => r.key === 'super_admin')!.permissions).toEqual(['*']);
  });
  it('applies to real accounts, and Chairman-stage actions stay with the Chairman (and the Super Admin who assists)', async () => {
    const subj = async (who: string) => runAs(ids.org, u[who], async (c) => c.subject);
    const admin = await subj('admin'), sa = await subj('superadmin');
    expect(can(admin, 'crm:manage').allow).toBe(true);
    expect(can(admin, 'payroll:manage').allow).toBe(true);
    for (const a of ['finance:approve', 'payroll:approve', 'discipline:decide']) { expect(can(admin, a).allow, a).toBe(false); expect(can(sa, a).allow, a).toBe(true); }
    expect(can(admin, 'backend:access').allow).toBe(false);
  });
  it('sees and can act on reports, leave, finance entries, opportunities and module records staff created', async () => {
    const p = await privileged();
    const emp = (await p.query<any>(`select id from employees where user_id = $1`, [u.presenter]))[0].id;
    const type = (await p.query<any>(`select id from leave_types where org_id = $1 limit 1`, [ids.org]))[0].id;
    await p.query(`insert into leave_requests (org_id, employee_id, leave_type_id, start_date, end_date, days) values ($1,$2,$3,current_date + 20,current_date + 21,2)`, [ids.org, emp, type]);
    const acc = (await p.query<any>(`insert into crm_accounts (org_id, name, created_by) values ($1,'Oversight Co',$2) returning id`, [ids.org, u.sales]))[0].id;
    const opp = (await p.query<any>(`insert into crm_opportunities (org_id, account_id, title, value, owner_user_id, created_by) values ($1,$2,'Big spot deal',1000,$3,$3) returning id`, [ids.org, acc, u.sales]))[0].id;
    const feed = await as('admin', (c) => recentActivity(c, { days: 30, limit: 200 }));
    expect(feed.some((i) => i.kind === 'leave' && i.by === u.presenter)).toBe(true);
    expect(feed.some((i) => i.kind === 'opportunity' && i.id === opp && i.removable)).toBe(true);
    await as('admin', (c) => moderate(c, 'opportunity', opp, 'Entered by mistake'));
    expect((await p.query<any>('select stage, lost_reason from crm_opportunities where id = $1', [opp]))[0]).toMatchObject({ stage: 'lost' });
    await expect(as('admin', (c) => moderate(c, 'opportunity', opp, 'Closing it again'))).rejects.toThrow(/already removed/);
    const mod = await as('admin', (c) => recentActivity(c, { kind: 'finance' }));
    expect(mod.every((i) => i.kind === 'finance' && !i.removable)).toBe(true);
  });
});
