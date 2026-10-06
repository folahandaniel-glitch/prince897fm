import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';

/** Small, audited "edit" operations for records that could previously only be added. */

const time = /^([01]\d|2[0-3]):[0-5]\d$/;
const emailOk = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

export async function renameStructure(c: Ctx, kind: 'department' | 'position', id: string, i: { name: string; code?: string; rankLevel?: number }) {
  need(c, 'structure:manage');
  const name = i.name.trim();
  if (name.length < 2 || name.length > 80) throw new UserError('Enter a name between 2 and 80 characters.');
  const table = kind === 'department' ? 'departments' : 'positions';
  if ((await c.q.query(`select 1 from ${table} where lower(name) = lower($1) and archived_at is null and id <> $2`, [name, id]))[0]) throw new UserError(`A ${kind} named "${name}" already exists.`);
  const r = kind === 'department'
    ? await c.q.query('update departments set name = $2, code = $3 where id = $1 returning id', [id, name, i.code?.trim() || null])
    : await c.q.query('update positions set name = $2, rank_level = $3 where id = $1 returning id', [id, name, Number.isInteger(i.rankLevel) ? i.rankLevel : 100]);
  if (!r[0]) throw new UserError('Not found.');
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: `${kind}.updated`, entity: kind, entityId: id, after: { name }, ip: c.ip, userAgent: c.userAgent });
}

export async function updateEmployee(c: Ctx, id: string, i: { fullName: string; phone?: string; employmentType?: string; status?: string }) {
  need(c, 'employee:edit');
  const name = i.fullName.trim();
  if (name.length < 2 || name.length > 120) throw new UserError('Enter the full name.');
  if (i.status && !['active', 'on_leave', 'suspended'].includes(i.status)) throw new UserError('Choose a valid status.');
  const before = (await c.q.query<any>('select full_name, phone, employment_type, status from employees where id = $1', [id]))[0];
  if (!before) throw new UserError('Employee not found.');
  if (before.status === 'exited') throw new UserError('This person has left. Their record is kept as it is.');
  await c.q.query('update employees set full_name = $2, phone = $3, employment_type = coalesce($4, employment_type), status = coalesce($5, status) where id = $1', [id, name, i.phone?.trim() || null, i.employmentType?.trim() || null, i.status || null]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'employee.updated', entity: 'employee', entityId: id, before, after: { full_name: name, phone: i.phone?.trim() || null, employment_type: i.employmentType ?? before.employment_type, status: i.status ?? before.status }, ip: c.ip, userAgent: c.userAgent });
}

export async function updateLeaveType(c: Ctx, id: string, i: { name: string; annualDays: number; paid: boolean; carryOverMax?: number; prorate?: boolean }) {
  need(c, 'leave:manage');
  if (i.name.trim().length < 2) throw new UserError('Enter a leave type name.');
  if (!(i.annualDays >= 0 && i.annualDays <= 365)) throw new UserError('Annual days must be between 0 and 365 (0 = not capped).');
  const carry = i.carryOverMax ?? 0;
  if (!(carry >= 0 && carry <= 365)) throw new UserError('Carry-over must be between 0 and 365 days.');
  if ((await c.q.query('select 1 from leave_types where lower(name) = lower($1) and archived_at is null and id <> $2', [i.name.trim(), id]))[0]) throw new UserError('A leave type with that name already exists.');
  const r = await c.q.query('update leave_types set name=$2, annual_days=$3, paid=$4, carry_over_max=$5, prorate=$6 where id=$1 returning id', [id, i.name.trim(), i.annualDays, i.paid, carry, i.prorate ?? true]);
  if (!r[0]) throw new UserError('Leave type not found.');
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'leave_type.updated', entity: 'leave_type', entityId: id, after: { ...i }, ip: c.ip, userAgent: c.userAgent });
}

export async function archiveLeaveType(c: Ctx, id: string) {
  need(c, 'leave:manage');
  if ((await c.q.query(`select 1 from leave_requests where leave_type_id = $1 and status = 'pending'`, [id]))[0]) throw new UserError('Some requests of this type are still pending. Decide them first.');
  const r = await c.q.query('update leave_types set archived_at = now() where id = $1 and archived_at is null returning id', [id]);
  if (!r[0]) throw new UserError('Leave type not found.');
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'leave_type.archived', entity: 'leave_type', entityId: id, ip: c.ip, userAgent: c.userAgent });
}

export async function updateShift(c: Ctx, id: string, i: { name: string; start: string; end: string; graceMin?: number; earlyMin?: number }) {
  need(c, 'attendance:manage');
  if (!i.name.trim()) throw new UserError('Enter a shift name.');
  if (!time.test(i.start) || !time.test(i.end)) throw new UserError('Enter start and end times as HH:MM (24-hour).');
  if (i.start === i.end) throw new UserError('Start and end times cannot be identical.');
  const r = await c.q.query('update shifts set name=$2, start_time=$3, end_time=$4, grace_minutes=$5, early_window_minutes=$6 where id=$1 returning id', [id, i.name.trim(), i.start, i.end, i.graceMin ?? 10, i.earlyMin ?? 60]);
  if (!r[0]) throw new UserError('Shift not found.');
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'shift.updated', entity: 'shift', entityId: id, after: { ...i }, ip: c.ip, userAgent: c.userAgent });
}

export async function archiveShift(c: Ctx, id: string) {
  need(c, 'attendance:manage');
  if ((await c.q.query(`select 1 from roster_entries where shift_id = $1 and status = 'published' and superseded_at is null and work_date >= current_date`, [id]))[0]) throw new UserError('This shift is still rostered on upcoming days. Cancel or move those first.');
  const r = await c.q.query('update shifts set archived_at = now() where id = $1 and archived_at is null returning id', [id]);
  if (!r[0]) throw new UserError('Shift not found.');
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'shift.archived', entity: 'shift', entityId: id, ip: c.ip, userAgent: c.userAgent });
}

export async function updateCourse(c: Ctx, id: string, i: { name: string; description?: string; mandatory?: boolean; validMonths?: number | null }) {
  need(c, 'training:manage');
  if (i.name.trim().length < 2) throw new UserError('Enter the course name.');
  if (i.validMonths != null && !(Number.isInteger(i.validMonths) && i.validMonths >= 1 && i.validMonths <= 240)) throw new UserError('Validity must be between 1 and 240 months, or empty if it never expires.');
  if ((await c.q.query('select 1 from training_courses where lower(name) = lower($1) and id <> $2', [i.name.trim(), id]))[0]) throw new UserError('A course with that name already exists.');
  const r = await c.q.query('update training_courses set name=$2, description=$3, mandatory=$4, valid_months=$5 where id=$1 returning id', [id, i.name.trim(), i.description?.trim() || null, !!i.mandatory, i.validMonths ?? null]);
  if (!r[0]) throw new UserError('Course not found.');
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'training.course_updated', entity: 'training_course', entityId: id, after: { name: i.name.trim(), mandatory: !!i.mandatory }, ip: c.ip, userAgent: c.userAgent });
}

export async function archiveCourse(c: Ctx, id: string) {
  need(c, 'training:manage');
  const r = await c.q.query('update training_courses set archived_at = now() where id = $1 and archived_at is null returning id', [id]);
  if (!r[0]) throw new UserError('Course not found.');
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'training.course_archived', entity: 'training_course', entityId: id, ip: c.ip, userAgent: c.userAgent });
}

export async function updateCrmAccount(c: Ctx, id: string, i: { name: string; status?: string; industry?: string; phone?: string; email?: string; address?: string; notes?: string }) {
  need(c, 'crm:manage');
  const name = i.name.trim();
  if (name.length < 2) throw new UserError('Enter a name.');
  if (i.email?.trim() && !emailOk(i.email.trim())) throw new UserError('Enter a valid email address.');
  if (i.status && !['lead', 'prospect', 'client', 'inactive'].includes(i.status)) throw new UserError('Choose a valid status.');
  if ((await c.q.query('select 1 from crm_accounts where lower(name) = lower($1) and id <> $2', [name, id]))[0]) throw new UserError('Another account already has that name.');
  const r = await c.q.query('update crm_accounts set name=$2, status=coalesce($3, status), industry=$4, phone=$5, email=$6, address=$7, notes=$8 where id=$1 returning id', [id, name, i.status || null, i.industry?.trim() || null, i.phone?.trim() || null, i.email?.trim().toLowerCase() || null, i.address?.trim() || null, i.notes?.trim() || null]);
  if (!r[0]) throw new UserError('Account not found.');
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'crm.account_updated', entity: 'crm_account', entityId: id, after: { name, status: i.status }, ip: c.ip, userAgent: c.userAgent });
}
