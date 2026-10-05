import { page, mutate, field } from '@/server/session';
import { importConfig } from '@/server/backend';
import { need } from '@/server/ctx';
import { ActionForm } from '@/components/forms';
import { Notice } from '@/components/ui';

export const metadata = { title: 'Configuration · BackEnd' };
export const dynamic = 'force-dynamic';

async function imp(_p: unknown, f: FormData) {
  'use server';
  const dry = field(f, 'intent') !== 'apply';
  return mutate(['/backend/config'], async (c) => {
    const r = await importConfig(c, field(f, 'json'), dry);
    const fmt = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing';
    return `${dry ? 'Dry run: would create' : 'Imported. Created'} ${fmt(r.created)}. Already present (left untouched): ${fmt(r.skipped)}.`;
  });
}

export default async function ConfigPage() {
  return page(async (p) => {
    need(p.ctx, 'backend:access');
    return (
      <div className="space-y-5">
        <Notice>Exports contain structure only (departments, shifts, leave types, modules, dashboards, rules). They never contain people, passwords, finance records or documents.</Notice>
        <section className="card"><h2 className="font-semibold">Export this organisation&apos;s configuration</h2><p className="mt-1 text-sm text-muted">Download a file you can keep as a backup of your set-up, or import into another organisation.</p><a className="btn-primary mt-3" href="/api/backend/config-export" download>Download configuration (JSON)</a></section>
        <section className="card"><h2 className="font-semibold">Import configuration</h2><p className="mt-1 text-sm text-muted">Import is additive: it creates what is missing and never overwrites or deletes. Run a dry run first.</p>
          <ActionForm action={imp as any} submit="Dry run" className="mt-3" buttons={[{ label: 'Dry run', value: 'dry', tone: 'ghost' }, { label: 'Apply import', value: 'apply' }]}><div><label className="label" htmlFor="json">Paste the exported JSON</label><textarea id="json" name="json" rows={8} required className="input py-2 font-mono text-xs" /></div></ActionForm></section>
      </div>
    );
  });
}
