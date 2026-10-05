import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page, mutate, field, optional } from '@/server/session';
import { assignmentOn, getEmployee, listEmployees, listStructure, transferEmployee } from '@/server/hr';
import { term } from '@/domain/config-schema';
import { ActionForm, Field, Select } from '@/components/forms';

export const dynamic = 'force-dynamic';

async function transfer(_p: unknown, f: FormData) {
  'use server';
  const id = field(f, 'employeeId');
  return mutate([`/employees/${id}`, '/employees'], async (c) => {
    await transferEmployee(c, {
      employeeId: id, effectiveFrom: field(f, 'effectiveFrom'), reason: field(f, 'reason'),
      departmentId: optional(f, 'departmentId') ?? undefined, branchId: optional(f, 'branchId') ?? undefined,
      positionId: optional(f, 'positionId') ?? undefined, supervisorId: optional(f, 'supervisorId') ?? undefined,
    });
    return 'Assignment recorded. Previous history is preserved.';
  });
}

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ on?: string }> }) {
  const { id } = await params; const { on } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return page(async (p) => {
    const data = await getEmployee(p.ctx, id);
    if (!data) notFound();
    const { employee: e, history } = data;
    const t = (k: string, f: 'singular' | 'plural' = 'singular') => term(p.terms, k, f);
    const asOf = on && /^\d{4}-\d{2}-\d{2}$/.test(on) ? await assignmentOn(p.ctx.q, id, on) : undefined;
    const canTransfer = p.allowed('employee:transfer');
    const st = canTransfer ? await listStructure(p.ctx.q) : null;
    const people = canTransfer ? await listEmployees(p.ctx, { limit: 100 }) : [];
    const opt = (rows: any[]) => rows.filter((r) => !r.archived_at).map((r) => ({ value: r.id, label: r.name }));
    return (
      <div className="space-y-6">
        <nav aria-label="Breadcrumb" className="text-sm text-muted"><Link href="/employees" className="underline">{t('employee', 'plural')}</Link> / {e.full_name}</nav>
        <header className="card">
          <h1 className="text-2xl font-bold">{e.full_name}</h1>
          <p className="text-sm text-muted">{e.employee_no} · {e.email} · joined {String(e.joined_on).slice(0, 10)} · <span className="badge">{e.status}</span></p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-4 text-sm">
            <div><dt className="text-muted">{t('department')}</dt><dd className="font-medium">{e.department ?? '—'}</dd></div>
            <div><dt className="text-muted">{t('position')}</dt><dd className="font-medium">{e.position ?? '—'}</dd></div>
            <div><dt className="text-muted">{t('branch')}</dt><dd className="font-medium">{e.branch ?? '—'}</dd></div>
            <div><dt className="text-muted">{t('supervisor')}</dt><dd className="font-medium">{e.supervisor ?? '—'}</dd></div>
          </dl>
        </header>

        <section className="card" aria-labelledby="asof">
          <h2 id="asof" className="font-semibold">Where were they on a given date?</h2>
          <form className="mt-2 flex flex-wrap items-end gap-2"><div><label className="label" htmlFor="on">Date</label><input id="on" name="on" type="date" defaultValue={on} className="input" /></div><button className="btn-ghost">Look up</button></form>
          {asOf !== undefined && (asOf
            ? <p className="mt-3 text-sm">On <strong>{on}</strong>: {t('department')} <strong>{asOf.department ?? '—'}</strong>, {t('position').toLowerCase()} <strong>{asOf.position ?? '—'}</strong>, {t('supervisor').toLowerCase()} <strong>{asOf.supervisor ?? '—'}</strong>.</p>
            : <p className="mt-3 text-sm text-muted">No assignment on record for that date.</p>)}
        </section>

        <section className="card" aria-labelledby="hist">
          <h2 id="hist" className="font-semibold">Assignment history</h2>
          <ol className="mt-3 space-y-3">{history.map((h: any) => (
            <li key={h.id} className="border-l-2 border-brand pl-3 text-sm">
              <p className="font-medium">{h.department ?? '—'} · {h.position ?? '—'} · {h.branch ?? '—'}</p>
              <p className="text-muted">{h.valid_from} → {h.valid_to ?? 'present'}{h.supervisor ? ` · ${t('supervisor')}: ${h.supervisor}` : ''}</p>
              {h.reason && <p className="text-muted">Reason: {h.reason}{h.approved_by ? ` (approved by ${h.approved_by})` : ''}</p>}
            </li>))}</ol>
        </section>

        {canTransfer && st && (
          <section className="card" aria-labelledby="tr">
            <h2 id="tr" className="font-semibold">Transfer or reassign</h2>
            <p className="text-sm text-muted">Leave a field unchanged to keep its current value. This adds a new dated assignment; nothing is overwritten.</p>
            <ActionForm action={transfer as any} submit="Record transfer" className="mt-3">
              <input type="hidden" name="employeeId" value={id} />
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Select label={t('department')} name="departmentId" defaultValue={e.department_id} options={opt(st.departments)} allowEmpty />
                <Select label={t('position')} name="positionId" defaultValue={null} options={opt(st.positions)} />
                <Select label={t('branch')} name="branchId" options={opt(st.branches)} />
                <Select label={t('supervisor')} name="supervisorId" options={people.filter((x: any) => x.id !== id).map((x: any) => ({ value: x.id, label: x.full_name }))} />
                <Field label="Effective from" name="effectiveFrom" type="date" required />
                <Field label="Reason" name="reason" required placeholder="e.g. Programme restructure" />
              </div>
            </ActionForm>
          </section>
        )}
      </div>
    );
  });
}
