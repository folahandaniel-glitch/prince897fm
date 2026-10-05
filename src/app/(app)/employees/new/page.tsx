import { page, mutate, field, optional } from '@/server/session';
import { createEmployee, listEmployees, listStructure } from '@/server/hr';
import { need } from '@/server/ctx';
import { term } from '@/domain/config-schema';
import { ActionForm, Field, Select } from '@/components/forms';

export const metadata = { title: 'Add employee' };

async function create(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/employees'], async (c) => {
    const r = await createEmployee(c, {
      fullName: field(f, 'fullName'), email: field(f, 'email'), phone: field(f, 'phone'), joinedOn: field(f, 'joinedOn') || undefined,
      departmentId: optional(f, 'departmentId'), branchId: optional(f, 'branchId'), positionId: optional(f, 'positionId'), supervisorId: optional(f, 'supervisorId'),
    });
    return `Created ${r.employeeNo}.`;
  });
}

export default async function NewEmployee() {
  return page(async (p) => {
    need(p.ctx, 'employee:create');
    const st = await listStructure(p.ctx.q);
    const sup = await listEmployees(p.ctx, { limit: 100 }).catch(() => []);
    const t = (k: string) => term(p.terms, k);
    const opt = (rows: any[]) => rows.filter((r) => !r.archived_at).map((r) => ({ value: r.id, label: r.name }));
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="text-2xl font-bold">Add {t('employee').toLowerCase()}</h1>
        <p className="text-sm text-muted">Each person has exactly one permanent identity. Later moves are recorded as dated assignments, never as new records.</p>
        <div className="card"><ActionForm action={create as any} submit={`Add ${t('employee').toLowerCase()}`}>
          <Field label="Full name" name="fullName" required /><Field label="Work email" name="email" type="email" required /><Field label="Phone" name="phone" type="tel" />
          <Field label="Date joined" name="joinedOn" type="date" />
          <Select label={t('department')} name="departmentId" options={opt(st.departments)} />
          <Select label={t('branch')} name="branchId" options={opt(st.branches)} />
          <Select label={t('position')} name="positionId" options={opt(st.positions)} />
          <Select label={t('supervisor')} name="supervisorId" options={sup.map((s: any) => ({ value: s.id, label: s.full_name }))} />
        </ActionForm></div>
      </div>
    );
  });
}
