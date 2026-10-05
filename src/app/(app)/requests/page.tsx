import { page, mutate, field, optional } from '@/server/session';
import { decideRegistration, listRegistrations, listStructure } from '@/server/hr';
import { need } from '@/server/ctx';
import { term } from '@/domain/config-schema';
import { ActionForm, Field, Select } from '@/components/forms';

export const metadata = { title: 'Registrations' };
export const dynamic = 'force-dynamic';

async function decide(_p: unknown, f: FormData) {
  'use server';
  const approve = field(f, 'decision') === 'approve';
  return mutate(['/requests', '/employees', '/dashboard'], async (c) => {
    await decideRegistration(c, {
      requestId: field(f, 'requestId'), approve, reason: field(f, 'reason'),
      departmentId: optional(f, 'departmentId'), branchId: optional(f, 'branchId'), positionId: optional(f, 'positionId'), supervisorId: null,
      roleKey: field(f, 'roleKey') || 'employee',
    });
    return approve ? 'Approved. The person can now sign in.' : 'Rejected.';
  });
}

export default async function Requests() {
  return page(async (p) => {
    need(p.ctx, 'registration:review');
    const reqs = await listRegistrations(p.ctx);
    const st = await listStructure(p.ctx.q);
    const roles = await p.ctx.q.query<any>('select key, name from roles order by name');
    const t = (k: string) => term(p.terms, k);
    const opt = (rows: any[]) => rows.filter((r) => !r.archived_at).map((r) => ({ value: r.id, label: r.name }));
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Registrations</h1>
        <p className="text-sm text-muted">What people request is shown for reference. You set their actual {t('department').toLowerCase()}, {t('position').toLowerCase()} and role. Nothing is granted until you approve.</p>
        {reqs.length === 0 ? (
          <div className="card text-center"><p className="font-semibold">No registrations waiting</p><p className="mt-1 text-sm text-muted">Share your registration link <code>/register/{p.org.slug}</code> with new staff.</p></div>
        ) : reqs.map((r: any) => (
          <article key={r.id} className="card">
            <h2 className="font-semibold">{r.full_name} <span className="font-normal text-muted">· {r.email}</span></h2>
            <p className="text-sm text-muted">Requested: {r.dept_name ?? '—'} · {r.position_name ?? '—'} · {r.branch_name ?? '—'}</p>
            <ActionForm action={decide as any} submit="Approve" className="mt-3">
              <input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="decision" value="approve" />
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Select label={`Actual ${t('department').toLowerCase()}`} name="departmentId" defaultValue={r.requested_department_id} options={opt(st.departments)} />
                <Select label={`Actual ${t('position').toLowerCase()}`} name="positionId" defaultValue={r.requested_position_id} options={opt(st.positions)} />
                <Select label={`Actual ${t('branch').toLowerCase()}`} name="branchId" defaultValue={r.requested_branch_id} options={opt(st.branches)} />
                <Select label="Role (access)" name="roleKey" allowEmpty={false} defaultValue="employee" options={roles.map((x: any) => ({ value: x.key, label: x.name }))} />
              </div>
            </ActionForm>
            <ActionForm action={decide as any} submit="Reject" tone="danger" className="mt-3 border-t border-line pt-3" confirm="Reject this registration?">
              <input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="decision" value="reject" />
              <Field label="Reason for rejection" name="reason" />
            </ActionForm>
          </article>
        ))}
      </div>
    );
  });
}
