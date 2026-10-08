import { can } from '../domain/policy';
import { audit } from './audit';
import { hashPassword, passwordProblem } from './auth';
import { need, today, UserError, type Ctx } from './ctx';
import { privileged, withTenant, type Q } from './db';

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (s: string, label: string) => { if (!dateRe.test(s) || Number.isNaN(Date.parse(s))) throw new UserError(`${label} must be a valid date.`); return s; };

/** Foreign keys bypass RLS, so every referenced id is re-checked through the tenant-scoped connection. */
async function owned(q: Q, table: 'departments' | 'branches' | 'positions' | 'employees', id: string | null | undefined, label: string) {
  if (!id) return null;
  const r = await q.query(`select id from ${table} where id = $1`, [id]);
  if (!r[0]) throw new UserError(`Unknown ${label}.`);
  return id;
}

// ---- Employees ---------------------------------------------------------------------------------
const CURRENT = `a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)`;

export async function listEmployees(c: Ctx, opts: { search?: string; limit?: number; offset?: number } = {}) {
  need(c, 'employee:view');
  const search = opts.search?.trim();
  const params: unknown[] = [];
  let where = '';
  if (search) { params.push(`%${search.toLowerCase()}%`); where = `where lower(e.full_name) like $1 or lower(e.employee_no) like $1 or lower(e.email) like $1`; }
  params.push(Math.min(opts.limit ?? 25, 100), opts.offset ?? 0);
  const rows = await c.q.query<any>(
    `select e.id, e.employee_no, e.full_name, e.email, e.status, d.name as department, b.name as branch, p.name as position, d.id as department_id, b.id as branch_id
       from employees e
       left join assignments a on a.employee_id = e.id and ${CURRENT}
       left join departments d on d.id = a.department_id left join branches b on b.id = a.branch_id left join positions p on p.id = a.position_id
       ${where} order by e.full_name limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  // Department/branch scoped grants: drop rows the caller may not see.
  return rows.filter((r) => can(c.subject, 'employee:view', { departmentId: r.department_id, branchId: r.branch_id, ownerEmployeeId: r.id, ownerUserId: null }).allow);
}

export async function getEmployee(c: Ctx, id: string) {
  const e = (await c.q.query<any>(
    `select e.*, e.joined_on::text as joined_on, d.name as department, d.id as department_id, b.name as branch, b.id as branch_id, p.name as position, s.full_name as supervisor
       from employees e left join assignments a on a.employee_id = e.id and ${CURRENT}
       left join departments d on d.id = a.department_id left join branches b on b.id = a.branch_id left join positions p on p.id = a.position_id left join employees s on s.id = a.supervisor_id
      where e.id = $1`, [id]))[0];
  if (!e) return null;
  need(c, 'employee:view', { departmentId: e.department_id, branchId: e.branch_id, ownerEmployeeId: e.id, ownerUserId: e.user_id });
  const history = await c.q.query<any>(
    `select a.id, a.kind, a.valid_from::text, a.valid_to::text, a.recorded_at, a.superseded_at, a.reason,
            d.name as department, b.name as branch, p.name as position, s.full_name as supervisor, u.email as approved_by
       from assignments a left join departments d on d.id = a.department_id left join branches b on b.id = a.branch_id
       left join positions p on p.id = a.position_id left join employees s on s.id = a.supervisor_id left join users u on u.id = a.approved_by
      where a.employee_id = $1 and a.superseded_at is null order by a.valid_from desc`, [id]);
  return { employee: e, history };
}

/** "Which department did this employee belong to on date D, and who was their supervisor?" */
export async function assignmentOn(q: Q, employeeId: string, date: string) {
  asDate(date, 'Date');
  const r = await q.query<any>(
    `select d.name as department, b.name as branch, p.name as position, s.full_name as supervisor, a.valid_from::text, a.valid_to::text
       from assignments a left join departments d on d.id = a.department_id left join branches b on b.id = a.branch_id
       left join positions p on p.id = a.position_id left join employees s on s.id = a.supervisor_id
      where a.employee_id = $1 and a.kind = 'substantive' and a.superseded_at is null and a.valid_from <= $2::date and (a.valid_to is null or a.valid_to > $2::date)`,
    [employeeId, date]);
  return r[0] ?? null;
}

async function nextEmployeeNo(q: Q, orgId: string) {
  await q.query('select pg_advisory_xact_lock(hashtext($1))', [`empno:${orgId}`]);
  const r = await q.query<{ n: number }>(`select coalesce(max(substring(employee_no from '[0-9]+$')::int), 0) + 1 as n from employees`);
  return `EMP-${String(r[0].n).padStart(4, '0')}`;
}

export interface NewEmployee {
  fullName: string; email: string; phone?: string; employmentType?: string; joinedOn?: string;
  departmentId?: string | null; branchId?: string | null; positionId?: string | null; supervisorId?: string | null;
  userId?: string | null;
}

export async function createEmployee(c: Ctx, input: NewEmployee) {
  need(c, 'employee:create', { departmentId: input.departmentId ?? null, branchId: input.branchId ?? null });
  const name = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  if (name.length < 2) throw new UserError('Enter the full name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError('Enter a valid email address.');
  const joined = asDate(input.joinedOn ?? today(), 'Joining date');
  await Promise.all([owned(c.q, 'departments', input.departmentId, 'department'), owned(c.q, 'branches', input.branchId, 'branch'),
    owned(c.q, 'positions', input.positionId, 'position'), owned(c.q, 'employees', input.supervisorId, 'supervisor')]);
  const dup = await c.q.query('select id from employees where email = $1', [email]);
  if (dup[0]) throw new UserError('An employee with this email already exists. Each person has exactly one permanent employee identity.');
  const no = await nextEmployeeNo(c.q, c.orgId);
  const [{ id }] = await c.q.query<{ id: string }>(
    `insert into employees (org_id, user_id, employee_no, full_name, email, phone, employment_type, joined_on) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [c.orgId, input.userId ?? null, no, name, email, input.phone ?? null, input.employmentType ?? 'permanent', joined]);
  await c.q.query(
    `insert into assignments (org_id, employee_id, department_id, branch_id, position_id, supervisor_id, valid_from, reason, approved_by) values ($1,$2,$3,$4,$5,$6,$7,'Initial assignment',$8)`,
    [c.orgId, id, input.departmentId ?? null, input.branchId ?? null, input.positionId ?? null, input.supervisorId ?? null, joined, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'employee.created', entity: 'employee', entityId: id, after: { ...input, employeeNo: no, fullName: name, email }, ip: c.ip, userAgent: c.userAgent });
  return { id, employeeNo: no };
}

export interface Transfer {
  employeeId: string; effectiveFrom: string; reason: string;
  departmentId?: string | null; branchId?: string | null; positionId?: string | null; supervisorId?: string | null;
}

/**
 * Transfer = new effective-dated assignment. The employee identity never changes and prior rows are
 * never overwritten: the old row is superseded (system time) and re-recorded truncated at the effective date.
 */
export async function transferEmployee(c: Ctx, t: Transfer) {
  if (!t.reason.trim()) throw new UserError('A reason is required for a transfer.');
  const from = asDate(t.effectiveFrom, 'Effective date');
  const emp = (await c.q.query<any>('select id, user_id from employees where id = $1 for update', [t.employeeId]))[0];
  if (!emp) throw new UserError('Employee not found.');
  const cur = (await c.q.query<any>(
    `select * , valid_from::text as vf from assignments a where employee_id = $1 and kind = 'substantive' and superseded_at is null and valid_to is null`, [t.employeeId]))[0];
  need(c, 'employee:transfer', { departmentId: cur?.department_id ?? null, branchId: cur?.branch_id ?? null });
  const next = {
    department: t.departmentId === undefined ? cur?.department_id ?? null : t.departmentId,
    branch: t.branchId === undefined ? cur?.branch_id ?? null : t.branchId,
    position: t.positionId === undefined ? cur?.position_id ?? null : t.positionId,
    supervisor: t.supervisorId === undefined ? cur?.supervisor_id ?? null : t.supervisorId,
  };
  if (next.supervisor === t.employeeId) throw new UserError('An employee cannot supervise themselves.');
  await Promise.all([owned(c.q, 'departments', next.department, 'department'), owned(c.q, 'branches', next.branch, 'branch'),
    owned(c.q, 'positions', next.position, 'position'), owned(c.q, 'employees', next.supervisor, 'supervisor')]);
  if (cur) {
    if (from <= cur.vf) throw new UserError(`The effective date must be after the current assignment began (${cur.vf}).`);
    await c.q.query('update assignments set superseded_at = now() where id = $1', [cur.id]);
    await c.q.query(
      `insert into assignments (org_id, employee_id, department_id, branch_id, position_id, supervisor_id, kind, valid_from, valid_to, reason, approved_by, recorded_at)
       values ($1,$2,$3,$4,$5,$6,'substantive',$7,$8,$9,$10,$11)`,
      [c.orgId, t.employeeId, cur.department_id, cur.branch_id, cur.position_id, cur.supervisor_id, cur.vf, from, cur.reason, cur.approved_by, cur.recorded_at]);
  }
  await c.q.query(
    `insert into assignments (org_id, employee_id, department_id, branch_id, position_id, supervisor_id, valid_from, reason, approved_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [c.orgId, t.employeeId, next.department, next.branch, next.position, next.supervisor, from, t.reason.trim(), c.userId]);
  await audit(c.q, {
    orgId: c.orgId, actorUserId: c.userId, action: 'employee.transferred', entity: 'employee', entityId: t.employeeId,
    before: cur ? { department: cur.department_id, branch: cur.branch_id, position: cur.position_id, supervisor: cur.supervisor_id } : null,
    after: { ...next, effectiveFrom: from }, reason: t.reason, ip: c.ip, userAgent: c.userAgent,
  });
  if (emp.user_id) await notify(c.q, c.orgId, emp.user_id, 'Your assignment has changed', `Effective ${from}. Reason: ${t.reason.trim()}`, `/employees/${t.employeeId}`);
}

export async function notify(q: Q, orgId: string, userId: string, title: string, body?: string, href?: string) {
  await q.query('insert into notifications (org_id, user_id, title, body, href) values ($1,$2,$3,$4,$5)', [orgId, userId, title, body ?? null, href ?? null]);
}

// ---- Registration (requested != actual authority) ------------------------------------------------------
export interface RegistrationInput {
  orgSlug: string; fullName: string; email: string; phone?: string; password: string;
  departmentId?: string; branchId?: string; positionId?: string; employmentType?: string; username?: string; birthDate?: string;
}

export async function submitRegistration(input: RegistrationInput) {
  const email = input.email.trim().toLowerCase();
  if (input.fullName.trim().length < 2) throw new UserError('Enter your full name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError('Enter a valid email address.');
  const problem = passwordProblem(input.password, { email });
  if (problem) throw new UserError(problem);
  const username = (input.username ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) throw new UserError('Choose a username of 3 to 30 characters using letters, numbers, dots, dashes or underscores.');
  const phone = (input.phone ?? '').replace(/[\s()-]/g, '');
  if (!/^\+?\d{7,15}$/.test(phone)) throw new UserError('Enter a valid phone number (digits only, 7 to 15 numbers).');
  const dob = input.birthDate ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(Date.parse(dob)) || dob > new Date().toISOString().slice(0, 10) || Number(dob.slice(0, 4)) < 1930 || Number(dob.slice(0, 4)) > new Date().getUTCFullYear() - 14) throw new UserError('Enter your date of birth.');
  if (!input.departmentId || !input.branchId || !input.positionId) throw new UserError('Choose your department, branch and position.');
  if (!['permanent', 'contract', 'probation', 'intern', 'volunteer', 'freelance'].includes(input.employmentType ?? '')) throw new UserError('Choose your employment type.');
  const org = (await (await privileged()).query<any>(`select id from organizations where slug = $1 and status = 'active'`, [input.orgSlug.toLowerCase()]))[0];
  if (!org) throw new UserError('Organisation not found.');
  const hash = hashPassword(input.password);
  await withTenant(org.id, async (q) => {
    const taken = await q.query('select 1 from users where email = $1 union all select 1 from registration_requests where email = $1 and status = $2', [email, 'pending']);
    if (taken[0]) throw new UserError('A registration or account already exists for this email.');
    const nameTaken = await q.query('select 1 from users where username = $1 or email = $1 union all select 1 from registration_requests where username = $1 and status = $2', [username, 'pending']);
    if (nameTaken[0]) throw new UserError('That username is already taken. Choose another.');
    await Promise.all([owned(q, 'departments', input.departmentId, 'department'), owned(q, 'branches', input.branchId, 'branch'), owned(q, 'positions', input.positionId, 'position')]);
    const [{ id }] = await q.query<{ id: string }>(
      `insert into registration_requests (org_id, email, full_name, phone, password_hash, requested_department_id, requested_branch_id, requested_position_id, requested_employment_type, username, birth_date)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [org.id, email, input.fullName.trim(), phone, hash, input.departmentId || null, input.branchId || null, input.positionId || null, input.employmentType ?? null, username, dob]);
    await audit(q, { orgId: org.id, action: 'registration.submitted', entity: 'registration', entityId: id, after: { email, requested: { department: input.departmentId, position: input.positionId } } });
  });
}

export async function listRegistrations(c: Ctx, status = 'pending') {
  need(c, 'registration:review');
  return c.q.query<any>(
    `select r.*, d.name as dept_name, b.name as branch_name, p.name as position_name from registration_requests r
       left join departments d on d.id = r.requested_department_id left join branches b on b.id = r.requested_branch_id left join positions p on p.id = r.requested_position_id
      where r.status = $1 order by r.created_at`, [status]);
}

export interface Decision {
  requestId: string; approve: boolean; reason?: string;
  departmentId?: string | null; branchId?: string | null; positionId?: string | null; supervisorId?: string | null; roleKey?: string;
}

/** The reviewer sets the ACTUAL department/position/role explicitly; the requested values are only a suggestion. */
export async function decideRegistration(c: Ctx, d: Decision) {
  need(c, 'registration:review');
  const r = (await c.q.query<any>('select * from registration_requests where id = $1 for update', [d.requestId]))[0];
  if (!r || r.status !== 'pending') throw new UserError('This request has already been decided.');
  if (!d.approve) {
    if (!d.reason?.trim()) throw new UserError('Give a reason for rejecting this request.');
    await c.q.query(`update registration_requests set status = 'rejected', decided_by = $2, decided_at = now(), decision_reason = $3 where id = $1`, [r.id, c.userId, d.reason.trim()]);
    await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'registration.rejected', entity: 'registration', entityId: r.id, reason: d.reason, ip: c.ip, userAgent: c.userAgent });
    return;
  }
  const roleKey = d.roleKey ?? 'employee';
  const role = (await c.q.query<any>('select id, key from roles where key = $1', [roleKey]))[0];
  if (!role) throw new UserError('Unknown role.');
  // Granting anything beyond the base role requires the ability to manage roles.
  if (role.key !== 'employee') need(c, 'role:manage');
  const [{ id: userId }] = await c.q.query<{ id: string }>(`insert into users (org_id, email, password_hash, username) values ($1,$2,$3,$4) returning id`, [c.orgId, r.email, r.password_hash, r.username ?? null]);
  await c.q.query('insert into user_roles (org_id, user_id, role_id, granted_by) values ($1,$2,$3,$4)', [c.orgId, userId, role.id, c.userId]);
  const emp = await createEmployee(c, {
    fullName: r.full_name, email: r.email, phone: r.phone, employmentType: r.requested_employment_type ?? 'permanent', userId,
    departmentId: d.departmentId ?? null, branchId: d.branchId ?? null, positionId: d.positionId ?? null, supervisorId: d.supervisorId ?? null,
  });
  if (r.birth_date) await c.q.query('update employees set birth_date = $2 where id = $1', [emp.id, r.birth_date]);
  await c.q.query(`update registration_requests set status = 'approved', decided_by = $2, decided_at = now(), employee_id = $3, decision_reason = $4 where id = $1`, [r.id, c.userId, emp.id, d.reason ?? null]);
  await audit(c.q, {
    orgId: c.orgId, actorUserId: c.userId, action: 'registration.approved', entity: 'registration', entityId: r.id,
    before: { requested: { department: r.requested_department_id, branch: r.requested_branch_id, position: r.requested_position_id } },
    after: { granted: { department: d.departmentId, branch: d.branchId, position: d.positionId, role: roleKey }, employeeId: emp.id }, ip: c.ip, userAgent: c.userAgent,
  });
  await notify(c.q, c.orgId, userId, 'Welcome aboard', 'Your registration was approved.', '/dashboard');
}

// ---- Structure ----------------------------------------------------------------------------------------------
export async function listStructure(q: Q) {
  const [departments, branches, positions] = await Promise.all([
    q.query<any>('select id, name, code, archived_at from departments order by sort_order, name'),
    q.query<any>('select id, name, code, region, archived_at from branches order by sort_order, name'),
    q.query<any>('select id, name, rank_level, archived_at from positions order by rank_level, name'),
  ]);
  return { departments, branches, positions };
}

export async function addStructure(c: Ctx, kind: 'department' | 'branch' | 'position', name: string, extra?: { code?: string; rankLevel?: number }) {
  need(c, 'structure:manage');
  const n = name.trim();
  if (n.length < 2 || n.length > 80) throw new UserError('Enter a name between 2 and 80 characters.');
  const table = kind === 'department' ? 'departments' : kind === 'branch' ? 'branches' : 'positions';
  const dup = await c.q.query(`select 1 from ${table} where lower(name) = lower($1) and archived_at is null`, [n]);
  if (dup[0]) throw new UserError(`A ${kind} named "${n}" already exists.`);
  const rows = kind === 'position'
    ? await c.q.query<{ id: string }>('insert into positions (org_id, name, rank_level) values ($1,$2,$3) returning id', [c.orgId, n, extra?.rankLevel ?? 100])
    : await c.q.query<{ id: string }>(`insert into ${table} (org_id, name, code) values ($1,$2,$3) returning id`, [c.orgId, n, extra?.code?.trim() || null]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: `${kind}.created`, entity: kind, entityId: rows[0].id, after: { name: n }, ip: c.ip, userAgent: c.userAgent });
}

export async function archiveStructure(c: Ctx, kind: 'department' | 'branch' | 'position', id: string, reason: string) {
  need(c, 'structure:manage');
  if (!reason.trim()) throw new UserError('A reason is required to archive.');
  const table = kind === 'department' ? 'departments' : kind === 'branch' ? 'branches' : 'positions';
  const col = `${kind}_id`;
  const inUse = await c.q.query<{ c: number }>(`select count(*)::int c from assignments where ${col} = $1 and superseded_at is null and valid_to is null`, [id]);
  if (inUse[0].c > 0) throw new UserError(`${inUse[0].c} current assignment(s) still use this ${kind}. Transfer them first. Archiving never deletes history.`);
  await c.q.query(`update ${table} set archived_at = now() where id = $1`, [id]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: `${kind}.archived`, entity: kind, entityId: id, reason, ip: c.ip, userAgent: c.userAgent });
}

// ---- Dashboard / notifications / audit -------------------------------------------------------------------------
export async function dashboardStats(c: Ctx) {
  const [e] = await c.q.query<any>(`select count(*)::int total, count(*) filter (where status='active')::int active from employees`);
  const [r] = await c.q.query<any>(`select count(*)::int pending from registration_requests where status='pending'`);
  const byDept = await c.q.query<any>(
    `select coalesce(d.name,'Unassigned') as name, count(*)::int n from employees e left join assignments a on a.employee_id = e.id and ${CURRENT}
      left join departments d on d.id = a.department_id group by 1 order by n desc limit 8`);
  return { employees: e, pending: r.pending, byDept };
}

export async function myNotifications(c: Ctx, limit = 20) {
  return c.q.query<any>('select id, title, body, href, read_at, created_at from notifications where user_id = $1 order by created_at desc limit $2', [c.userId, limit]);
}
export async function markNotificationsRead(c: Ctx) {
  await c.q.query('update notifications set read_at = now() where user_id = $1 and read_at is null', [c.userId]);
}

export async function listAudit(c: Ctx, limit = 100) {
  need(c, 'audit:view');
  return c.q.query<any>(
    `select a.id, a.action, a.entity, a.entity_id, a.reason, a.created_at, u.email as actor, a.hash from audit_events a left join users u on u.id = a.actor_user_id
      order by a.id desc limit $1`, [limit]);
}
