import Link from 'next/link';
import { page, mutate, field } from '@/server/session';
import { listEntities, setEntityActive } from '@/server/builders';
import { installPack } from '@/server/backend';
import { MODULE_PACKS } from '@/domain/templates';
import { need } from '@/server/ctx';
import { ActionForm } from '@/components/forms';
import { Empty, PageHead } from '@/components/ui';

export const metadata = { title: 'Builder' };
export const dynamic = 'force-dynamic';

async function install(_p: unknown, f: FormData) { 'use server'; return mutate(['/builder'], async (c) => { await installPack(c, field(f, 'pack')); return 'Installed. It is now in the menu for the people allowed to use it.'; }); }
async function toggle(_p: unknown, f: FormData) { 'use server'; return mutate(['/builder'], async (c) => { await setEntityActive(c, field(f, 'key'), field(f, 'active') === 'true'); return 'Updated.'; }); }

export default async function Builder() {
  return page(async (p) => {
    p.requireFeature('builders');
    need(p.ctx, 'builder:manage');
    const entities = await listEntities(p.ctx.q);
    const have = new Set(entities.map((e) => e.key));
    return (
      <div className="space-y-6">
        <PageHead title="Builder" sub="Create modules, forms, dashboards and pages for your organisation without any programming.">
          <Link className="btn-primary" href="/builder/new">New module</Link><Link className="btn-ghost" href="/builder/automations">Automations</Link><Link className="btn-ghost" href="/builder/dashboards">Dashboards</Link><Link className="btn-ghost" href="/builder/pages">Pages</Link><Link className="btn-ghost" href="/builder/wallboards">TV wallboards</Link></PageHead>
        <section aria-labelledby="mods"><h2 id="mods" className="mb-2 font-semibold">Your modules</h2>
          {entities.length === 0 ? <Empty title="No custom modules yet" text="Install a ready-made pack below or build your own from scratch." /> : (
            <ul className="grid gap-3 sm:grid-cols-2">{entities.map((e) => (
              <li key={e.key} className="card"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{e.name}</p><p className="text-xs text-muted">{e.fields.filter((f) => !f.archived).length} fields · {e.statuses.length} statuses · v{e.version}{e.publicSlug ? ' · public form on' : ''}</p></div>{!e.active && <span className="badge">hidden</span>}</div>
                <div className="mt-3 flex flex-wrap gap-2"><Link className="btn-ghost" href={`/m/${e.key}`}>Open</Link><Link className="btn-ghost" href={`/builder/${e.key}`}>Edit</Link>
                  <ActionForm action={toggle as any} submit={e.active ? 'Hide' : 'Show'} tone="ghost" className="!mt-0"><input type="hidden" name="key" value={e.key} /><input type="hidden" name="active" value={String(!e.active)} /><span /></ActionForm></div></li>))}</ul>)}</section>
        <section aria-labelledby="packs"><h2 id="packs" className="mb-2 font-semibold">Ready-made packs</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{MODULE_PACKS.map((m) => (
            <li key={m.key} className="card"><p className="font-semibold">{m.name}</p><p className="text-xs uppercase text-muted">{m.pack}</p><p className="mt-1 text-sm text-muted">{m.description}</p>
              {have.has(m.key) ? <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">Installed</p> : <ActionForm action={install as any} submit="Install" tone="ghost" className="mt-2"><input type="hidden" name="pack" value={m.key} /></ActionForm>}</li>))}</ul></section>
      </div>
    );
  });
}
