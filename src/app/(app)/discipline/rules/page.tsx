import { page, mutate, field } from '@/server/session';
import { listRules, saveRule } from '@/server/discipline';
import { need } from '@/server/ctx';
import { ActionForm, Field } from '@/components/forms';
import { Notice, PageHead } from '@/components/ui';

export const metadata = { title: 'Discipline rules' };
export const dynamic = 'force-dynamic';

async function save(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/discipline/rules'], async (c) => { await saveRule(c, { id: field(f, 'id') || undefined, code: field(f, 'code'), title: field(f, 'title'), category: field(f, 'category') || 'General', description: field(f, 'description'), reference: field(f, 'reference'), guidance: field(f, 'guidance'), active: field(f, 'active') !== 'off' }); return 'Rule saved.'; });
}

export default async function Rules() {
  return page(async (p) => {
    p.requireFeature('discipline');
    const canEdit = p.allowed('discipline:manage');
    if (!canEdit && !p.allowed('discipline:raise')) need(p.ctx, 'discipline:manage');
    const rules = await listRules(p.ctx.q, false);
    return (
      <div className="space-y-5">
        <PageHead title="Rules, policies & guidance" sub="The library managers see when raising a matter. Add your handbook clauses and the Labour Law provisions that apply." />
        <Notice tone="warn">References here are starting text only. HR must complete the exact clause numbers and have legal counsel confirm them. Nothing here is legal advice.</Notice>
        <ul className="space-y-3">{rules.map((r: any) => (
          <li key={r.id} className="card"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{r.title} <span className="badge ml-1">{r.code}</span> <span className="badge">{r.category}</span> {!r.active && <span className="badge">inactive</span>}</p></div>
            <p className="mt-1 text-sm">{r.description}</p><p className="mt-2 text-xs text-muted"><strong>Reference:</strong> {r.reference || 'Not yet completed'}</p><p className="mt-1 text-xs text-muted"><strong>Procedure guidance:</strong> {r.guidance}</p>
            {canEdit && <details className="mt-3"><summary className="cursor-pointer text-sm underline">Edit</summary>
              <ActionForm action={save as any} submit="Save changes" className="mt-3"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="code" value={r.code} /><div className="grid gap-x-4 sm:grid-cols-2"><Field label="Title" name="title" required defaultValue={r.title} /><Field label="Category" name="category" defaultValue={r.category} /></div>
                <Field label="Description" name="description" required defaultValue={r.description} /><Field label="Handbook clause / legal reference" name="reference" defaultValue={r.reference} /><Field label="Procedure guidance" name="guidance" defaultValue={r.guidance} /></ActionForm></details>}</li>))}</ul>
        {canEdit && <section className="card"><h2 className="font-semibold">Add a rule</h2><ActionForm action={save as any} submit="Add rule" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-3"><Field label="Code" name="code" required placeholder="e.g. DRESS" /><Field label="Title" name="title" required /><Field label="Category" name="category" /></div><Field label="Description" name="description" required /><Field label="Handbook clause / legal reference" name="reference" /><Field label="Procedure guidance" name="guidance" /></ActionForm></section>}
      </div>
    );
  });
}
