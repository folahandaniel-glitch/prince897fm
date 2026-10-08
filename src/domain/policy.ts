/**
 * Policy decision point (RBAC base + ABAC refinement). Pure functions: no I/O, fully unit-tested.
 * Permission strings are `resource:action` (optionally `:own`). `*` and `resource:*` are wildcards.
 */
export interface Grant {
  roleKey: string;
  permissions: string[];
  departmentIds: string[] | null; // null = organisation-wide
  branchIds: string[] | null;
  validFrom: string; // ISO date
  validTo: string | null; // temporary / acting authority
}

export interface Subject {
  userId: string;
  orgId: string;
  employeeId?: string | null;
  grants: Grant[];
}

export interface Resource {
  orgId?: string;
  departmentId?: string | null;
  branchId?: string | null;
  ownerUserId?: string | null;
  ownerEmployeeId?: string | null;
}

export interface Decision {
  allow: boolean;
  reason: string;
  via?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

function matches(perm: string, action: string): 'any' | 'own' | null {
  if (perm === '*' || perm === action) return 'any';
  if (perm === `${action}:own`) return 'own';
  const [res] = action.split(':');
  if (perm === `${res}:*`) return 'any';
  return null;
}

export function can(subject: Subject, action: string, resource: Resource = {}, now: string = today()): Decision {
  if (resource.orgId && resource.orgId !== subject.orgId) return { allow: false, reason: 'Cross-organisation access is never permitted.' };
  let lastReason = 'No role grants this permission.';
  for (const g of subject.grants) {
    if (g.validFrom > now || (g.validTo && g.validTo < now)) { lastReason = 'The role granting this permission is not currently in effect.'; continue; }
    for (const p of g.permissions) {
      const m = matches(p, action);
      if (!m) continue;
      if (m === 'own') {
        const mine = (resource.ownerUserId && resource.ownerUserId === subject.userId) ||
          (resource.ownerEmployeeId && subject.employeeId && resource.ownerEmployeeId === subject.employeeId);
        if (!mine) { lastReason = 'You can only do this on your own records.'; continue; }
      }
      if (g.departmentIds && resource.departmentId != null && !g.departmentIds.includes(resource.departmentId)) {
        lastReason = 'This record is outside your department scope.'; continue;
      }
      if (g.branchIds && resource.branchId != null && !g.branchIds.includes(resource.branchId)) {
        lastReason = 'This record is outside your branch scope.'; continue;
      }
      return { allow: true, reason: 'Allowed', via: g.roleKey };
    }
  }
  return { allow: false, reason: lastReason };
}

export class ForbiddenError extends Error {
  constructor(message: string, public action?: string) { super(message); this.name = 'ForbiddenError'; }
}

export function assertCan(subject: Subject, action: string, resource?: Resource): void {
  const d = can(subject, action, resource);
  if (!d.allow) throw new ForbiddenError(d.reason, action);
}

/** Separation of duties: the same person may not hold more than one of the listed steps on one record. */
export function violatesSeparation(actorId: string, priorActorIdsByStep: Record<string, string | undefined>, conflictingSteps: string[]): string | null {
  for (const s of conflictingSteps) if (priorActorIdsByStep[s] === actorId) return `Separation of duties: you already performed "${s}" on this record.`;
  return null;
}

const BASE = ['notification:view:own', 'attendance:clock', 'leave:request', 'report:submit', 'task:create', 'payslip:view:own', 'discipline:view:own', 'ticket:create', 'doc:view', 'mail:use', 'calendar:view', 'training:view:own', 'roster:swap', 'kpi:view:own', 'assessment:take', 'profile:edit:own', 'deliverable:submit', 'kb:view', 'advance:request'];
const EXEC = ['kpi:view', 'memo:post', 'contract:view', 'quote:view', 'dashboard:executive', 'employee:view', 'attendance:view', 'report:review', 'report:oversee', 'task:assign', 'finance:view', 'finance:approve', 'finance:oversee', 'finance:export', 'payroll:approve', 'payroll:view', 'discipline:view', 'discipline:decide', 'crm:view', 'doc:upload', 'event:create', 'announcement:post', 'ticket:handle'];

export interface RoleDef { key: string; name: string; permissions: string[]; hidden?: boolean }
export const SYSTEM_ROLES: RoleDef[] = [
  // Hidden from every other user (enforced in the database). Full authority, including the Chairman's views; separation-of-duties rules still apply to it.
  { key: 'super_admin', name: 'Super Administrator', permissions: ['*'], hidden: true },
  { key: 'tenant_admin', name: 'Tenant Administrator', permissions: [...BASE, 'admin:control', 'kpi:view', 'kpi:rate', 'kpi:manage', 'assessment:manage', 'training:manage', 'structure:manage', 'config:manage', 'config:rollback', 'role:manage', 'audit:view', 'employee:view', 'employee:create', 'employee:edit', 'registration:review', 'attendance:manage', 'leave:manage', 'attendance:view', 'report:manage', 'task:assign', 'builder:manage', 'wallboard:manage', 'doc:upload', 'doc:manage', 'event:create', 'announcement:post', 'ticket:handle', 'ticket:manage'] },
  { key: 'executive', name: 'Executive (Chairman)', permissions: [...BASE, ...EXEC, 'audit:view', 'doc:manage', 'payroll:view'] },
  { key: 'ceo', name: 'CEO', permissions: [...BASE, ...EXEC, 'advance:approve'] },
  { key: 'finance_manager', name: 'Finance Manager', permissions: [...BASE, 'advance:approve', 'advance:pay', 'quote:view', 'quote:manage', 'contract:view', 'finance:view', 'finance:approve', 'finance:configure', 'finance:reverse', 'finance:reconcile', 'finance:export', 'payroll:view', 'payroll:approve', 'payroll:configure', 'crm:view'] },
  { key: 'accountant', name: 'Accountant', permissions: [...BASE, 'quote:view', 'finance:view', 'finance:review', 'finance:reconcile', 'finance:export', 'payroll:view', 'crm:view'] },
  { key: 'finance_officer', name: 'Finance Officer', permissions: [...BASE, 'advance:pay', 'quote:view', 'quote:manage', 'finance:view', 'finance:create', 'finance:pay', 'payroll:pay', 'crm:view'] },
  { key: 'hr_manager', name: 'HR Manager', permissions: [...BASE, 'deliverable:review', 'deliverable:manage', 'memo:post', 'kb:manage', 'advance:approve', 'contract:view', 'kpi:view', 'kpi:rate', 'kpi:manage', 'assessment:manage', 'training:manage', 'employee:view', 'employee:create', 'employee:edit', 'employee:transfer', 'registration:review', 'attendance:view', 'attendance:review', 'attendance:manage', 'roster:manage', 'leave:review', 'leave:manage', 'report:review', 'report:oversee', 'report:manage', 'task:assign', 'payroll:view', 'payroll:manage', 'discipline:view', 'discipline:manage', 'discipline:raise', 'discipline:decide', 'doc:upload', 'doc:manage', 'event:create', 'announcement:post', 'ticket:handle'] },
  { key: 'department_head', name: 'Head of Department', permissions: [...BASE, 'deliverable:review', 'kb:manage', 'kpi:view', 'kpi:rate', 'employee:view', 'attendance:view', 'attendance:review', 'roster:manage', 'leave:review', 'report:review', 'task:assign', 'discipline:raise', 'doc:upload', 'event:create', 'ticket:handle'] },
  { key: 'sales', name: 'Sales & Marketing', permissions: [...BASE, 'quote:view', 'quote:manage', 'contract:view', 'contract:manage', 'crm:view', 'crm:manage', 'doc:upload', 'event:create'] },
  { key: 'support', name: 'Support Officer', permissions: [...BASE, 'ticket:handle', 'crm:view'] },
  { key: 'registration_approver', name: 'Registration approver', permissions: [...BASE, 'employee:view:own', 'employee:view', 'employee:create', 'registration:review'] },
  { key: 'employee', name: 'Employee', permissions: [...BASE, 'employee:view:own'] },
];

/**
 * The Administrator can do everything inside the organisation except what belongs to the Chairman's approval stages and the BackEnd
 * (which is the Super Administrator's, who also assists the Chairman). Separation of duties still applies record by record.
 */
export const ADMIN_EXCLUDED = ['backend:access', 'finance:approve', 'payroll:approve', 'discipline:decide', 'dashboard:executive', 'finance:oversee'];
const everything = new Set(SYSTEM_ROLES.flatMap((r) => r.permissions).filter((x) => x !== '*'));
const admin = SYSTEM_ROLES.find((r) => r.key === 'tenant_admin')!;
admin.permissions = [...new Set([...admin.permissions, ...everything])].filter((p) => !ADMIN_EXCLUDED.includes(p)).sort();

/** Every permission string the system knows, for the role editor. */
export const ALL_PERMISSIONS: string[] = [...new Set(SYSTEM_ROLES.flatMap((r) => r.permissions).filter((x) => x !== '*').concat(['backend:access']))].sort();
