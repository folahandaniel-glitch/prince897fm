import type { Q } from './db';
import { withTenant } from './db';
import { assertCan, type Grant, type Resource, type Subject } from '../domain/policy';

export interface Ctx {
  q: Q;
  orgId: string;
  userId: string;
  subject: Subject;
  ip?: string | null;
  userAgent?: string | null;
}

export async function loadSubject(q: Q, orgId: string, userId: string): Promise<Subject> {
  const rows = await q.query<any>(
    `select r.key, r.permissions, ur.scope_department_ids, ur.scope_branch_ids, ur.valid_from::text, ur.valid_to::text
       from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1`,
    [userId],
  );
  const emp = await q.query<{ id: string }>('select id from employees where user_id = $1', [userId]);
  const grants: Grant[] = rows.map((r) => ({
    roleKey: r.key, permissions: r.permissions, departmentIds: r.scope_department_ids, branchIds: r.scope_branch_ids,
    validFrom: r.valid_from, validTo: r.valid_to,
  }));
  return { userId, orgId, employeeId: emp[0]?.id ?? null, grants };
}

/** Run feature code as `userId` inside one tenant-bound transaction. */
export async function runAs<T>(orgId: string, userId: string, fn: (c: Ctx) => Promise<T>, meta: { ip?: string | null; userAgent?: string | null } = {}): Promise<T> {
  return withTenant(orgId, async (q) => fn({ q, orgId, userId, subject: await loadSubject(q, orgId, userId), ...meta }), userId);
}

export const need = (c: Ctx, action: string, resource?: Resource) => assertCan(c.subject, action, resource);

export class UserError extends Error {
  constructor(message: string) { super(message); this.name = 'UserError'; }
}

export const today = () => new Date().toISOString().slice(0, 10);
