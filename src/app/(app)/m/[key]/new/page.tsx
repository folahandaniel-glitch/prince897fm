import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page, mutate, field } from '@/server/session';
import { createRecord, getEntity } from '@/server/builders';
import { DynFields } from '@/components/dyn-fields';
import { ActionForm } from '@/components/forms';
import { PageHead } from '@/components/ui';

export const dynamic = 'force-dynamic';

async function create(_p: unknown, f: FormData) {
  'use server';
  const key = field(f, 'module');
  return mutate([`/m/${key}`], async (c) => {
    const input: Record<string, unknown> = {};
    for (const k of new Set([...f.keys()])) if (k !== 'module' && !k.startsWith('$ACTION')) { const all = f.getAll(k).map(String); input[k] = all.length > 1 ? all : all[0]; }
    const r = await createRecord(c, key, input);
    return `${r.number} created.`;
  });
}

export default async function NewRecord({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return page(async (p) => {
    p.requireFeature('builders');
    const e = await getEntity(p.ctx.q, key);
    if (!e || !e.active) notFound();
    const [people, departments] = await Promise.all([
      e.fields.some((f) => f.type === 'employee' && !f.archived) ? p.ctx.q.query<any>(`select id, full_name as name from employees where status = 'active' order by full_name`) : [],
      e.fields.some((f) => f.type === 'department' && !f.archived) ? p.ctx.q.query<any>('select id, name from departments where archived_at is null order by name') : [],
    ]);
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHead title={`New ${e.name.toLowerCase()}`}><Link className="btn-ghost" href={`/m/${key}`}>← {e.plural}</Link></PageHead>
        <div className="card"><ActionForm action={create as any} submit="Save"><input type="hidden" name="module" value={key} /><DynFields fields={e.fields} people={people} departments={departments} /></ActionForm></div>
      </div>
    );
  });
}
