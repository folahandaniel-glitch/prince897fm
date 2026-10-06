import { page, mutate, field } from '@/server/session';
import { addStructure, archiveStructure, listStructure } from '@/server/hr';
import Link from 'next/link';
import { renameStructure } from '@/server/edits';
import { need } from '@/server/ctx';
import { term } from '@/domain/config-schema';
import { ActionForm, Field } from '@/components/forms';

export const metadata = { title: 'Structure' };
export const dynamic = 'force-dynamic';
type Kind = 'department' | 'branch' | 'position';

async function add(_p: unknown, f: FormData) {
  'use server';
  const kind = field(f, 'kind') as Kind;
  if (!['department', 'branch', 'position'].includes(kind)) return { error: 'Unknown type.' };
  return mutate(['/admin/structure'], async (c) => {
    await addStructure(c, kind, field(f, 'name'), { code: field(f, 'code'), rankLevel: Number(field(f, 'rank')) || 100 });
    return 'Added and available immediately.';
  });
}
async function rename(_p: unknown, f: FormData) {
  'use server';
  const kind = field(f, 'kind');
  if (kind !== 'department' && kind !== 'position') return { error: 'Unknown type.' };
  return mutate(['/admin/structure'], async (c) => { await renameStructure(c, kind, field(f, 'id'), { name: field(f, 'name'), code: field(f, 'code'), rankLevel: Number(field(f, 'rank')) || 100 }); return 'Saved.'; });
}
async function archive(_p: unknown, f: FormData) {
  'use server';
  const kind = field(f, 'kind') as Kind;
  if (!['department', 'branch', 'position'].includes(kind)) return { error: 'Unknown type.' };
  return mutate(['/admin/structure'], async (c) => { await archiveStructure(c, kind, field(f, 'id'), field(f, 'reason')); return 'Archived. History is unchanged.'; });
}

export default async function Structure() {
  return page(async (p) => {
    need(p.ctx, 'structure:manage');
    const st = await listStructure(p.ctx.q);
    const blocks: { kind: Kind; title: string; rows: any[]; ranked?: boolean }[] = [
      { kind: 'department', title: term(p.terms, 'department', 'plural'), rows: st.departments },
      { kind: 'branch', title: term(p.terms, 'branch', 'plural'), rows: st.branches },
      { kind: 'position', title: term(p.terms, 'position', 'plural'), rows: st.positions, ranked: true },
    ];
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Organisation structure</h1>
        <p className="text-sm text-muted">Changes take effect immediately. Items in use are archived, never deleted, so history stays intact.</p>
        <div className="grid gap-6 lg:grid-cols-3">
          {blocks.map((b) => (
            <section key={b.kind} className="card" aria-labelledby={`h-${b.kind}`}>
              <h2 id={`h-${b.kind}`} className="font-semibold">{b.title}</h2>
              <ul className="mt-3 divide-y divide-line text-sm">{b.rows.filter((r) => !r.archived_at).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2"><span>{r.name}{b.ranked && <span className="ml-2 text-xs text-muted">level {r.rank_level}</span>}</span>
                  <details className="text-right"><summary className="cursor-pointer text-xs text-muted underline">Edit / archive</summary>
                    {b.kind === 'branch' ? <p className="mt-2 w-56 text-left text-xs"><Link className="underline" href="/admin/branches">Edit name, address and Google coordinates</Link></p> : (
                      <ActionForm action={rename as any} submit="Save" className="mt-2 w-56 text-left"><input type="hidden" name="kind" value={b.kind} /><input type="hidden" name="id" value={r.id} /><Field label="Name" name="name" required defaultValue={r.name} />{b.ranked ? <Field label="Seniority level" name="rank" type="number" defaultValue={String(r.rank_level)} /> : <Field label="Code" name="code" defaultValue={r.code ?? ''} />}</ActionForm>)}
                    <ActionForm action={archive as any} submit="Archive" tone="danger" className="mt-2 w-56 text-left" confirm={`Archive ${r.name}?`}>
                      <input type="hidden" name="kind" value={b.kind} /><input type="hidden" name="id" value={r.id} /><Field label="Reason" name="reason" required />
                    </ActionForm></details></li>))}</ul>
              <ActionForm action={add as any} submit="Add" className="mt-4 border-t border-line pt-4">
                <input type="hidden" name="kind" value={b.kind} /><Field label={`New ${term(p.terms, b.kind).toLowerCase()} name`} name="name" required />
                {b.ranked && <Field label="Seniority level (1 = most senior)" name="rank" type="number" defaultValue="100" />}
              </ActionForm>
            </section>))}
        </div>
      </div>
    );
  });
}
