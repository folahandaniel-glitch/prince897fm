import { page, mutate, field, optional } from '@/server/session';
import { listDefs, saveDef, FREQUENCIES } from '@/server/deliverables';
import { LEVEL_BANDS } from '@/domain/kpi';
import { need } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';
import { PageHead } from '@/components/ui';

export const metadata = { title: 'Deliverable setup' };
export const dynamic = 'force-dynamic';

async function save(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/deliverables/setup'], async (c) => { await saveDef(c, { id: optional(f, 'id') ?? undefined, name: field(f, 'name'), description: field(f, 'description'), departmentId: optional(f, 'departmentId'), levelBand: optional(f, 'levelBand'), frequency: field(f, 'frequency'), targetCount: Number(field(f, 'targetCount')), active: field(f, 'active') !== 'no' }); return 'Saved.'; });
}

export default async function Setup() {
  return page(async (p) => {
    need(p.ctx, 'deliverable:manage');
    const [defs, deps] = await Promise.all([listDefs(p.ctx), p.ctx.q.query<any>('select id, name from departments order by name')]);
    const depOpts = deps.map((d: any) => ({ value: d.id, label: d.name }));
    const bandOpts = LEVEL_BANDS.map((b) => ({ value: b.key, label: b.label }));
    const freqOpts = FREQUENCIES.map((x) => ({ value: x, label: x }));
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <PageHead title="Deliverable setup" sub="Define the outputs each department and level must produce. Leave department or level empty to apply to everyone." />
        <section className="card"><h2 className="font-semibold">New deliverable</h2>
          <ActionForm action={save as any} submit="Add" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-2"><Field label="Name" name="name" required placeholder="e.g. Weekly programme log" />
            <Field label="Target per month" name="targetCount" type="number" required defaultValue="4" />
            <Select label="Department" name="departmentId" options={depOpts} /><Select label="Level" name="levelBand" options={bandOpts} />
            <Select label="How often" name="frequency" allowEmpty={false} defaultValue="weekly" options={freqOpts} /></div>
            <Field label="Description" name="description" /></ActionForm></section>
        <section className="card"><h2 className="font-semibold">Existing</h2>
          {defs.length === 0 ? <p className="mt-2 text-sm text-muted">None yet.</p> : <div className="mt-2 space-y-3">{defs.map((d: any) => (
            <details key={d.id} className="rounded-xl border border-line p-3"><summary className="cursor-pointer text-sm font-medium">{d.name} <span className="text-muted">· {d.department ?? 'All departments'} · {d.level_band ?? 'all levels'} · {d.target_count}/month{d.active ? '' : ' · inactive'}</span></summary>
              <ActionForm action={save as any} submit="Save changes" className="mt-3"><input type="hidden" name="id" value={d.id} /><div className="grid gap-x-4 sm:grid-cols-2"><Field label="Name" name="name" required defaultValue={d.name} /><Field label="Target per month" name="targetCount" type="number" required defaultValue={String(d.target_count)} />
                <Select label="Department" name="departmentId" options={depOpts} defaultValue={d.department_id} /><Select label="Level" name="levelBand" options={bandOpts} defaultValue={d.level_band} />
                <Select label="How often" name="frequency" allowEmpty={false} defaultValue={d.frequency} options={freqOpts} />
                <Select label="Status" name="active" allowEmpty={false} defaultValue={d.active ? 'yes' : 'no'} options={[{ value: 'yes', label: 'Active' }, { value: 'no', label: 'Inactive' }]} /></div>
                <Field label="Description" name="description" defaultValue={d.description ?? ''} /></ActionForm></details>))}</div>}</section>
      </div>
    );
  });
}
