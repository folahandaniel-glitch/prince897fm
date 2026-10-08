import { page, mutate, field } from '@/server/session';
import { listTemplates, saveTemplate, MERGE_FIELDS } from '@/server/contracts';
import { need } from '@/server/ctx';
import { ActionForm, Field } from '@/components/forms';
import { PageHead, Notice } from '@/components/ui';

export const metadata = { title: 'Contract templates' };
export const dynamic = 'force-dynamic';

async function save(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/contracts/templates'], async (c) => { await saveTemplate(c, { id: field(f, 'id') || undefined, name: field(f, 'name'), body: field(f, 'body'), active: field(f, 'active') !== 'no' }); return 'Saved.'; });
}

export default async function Templates() {
  return page(async (p) => {
    p.requireFeature('crm');
    need(p.ctx, 'contract:manage');
    const rows = await listTemplates(p.ctx);
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <PageHead title="Contract templates" />
        <Notice>Use these placeholders in the text; they are filled in when a contract is created: {MERGE_FIELDS.map((m) => `{{${m}}}`).join('  ')}. Have a lawyer approve your final wording.</Notice>
        <section className="card"><h2 className="font-semibold">New template</h2><ActionForm action={save as any} submit="Add template" className="mt-3"><Field label="Name" name="name" required /><div><label className="label" htmlFor="body">Text</label><textarea id="body" name="body" rows={8} required className="input py-2" /></div></ActionForm></section>
        {rows.map((t: any) => <details key={t.id} className="card"><summary className="cursor-pointer font-medium">{t.name}{t.active ? '' : ' (inactive)'}</summary>
          <ActionForm action={save as any} submit="Save changes" className="mt-3"><input type="hidden" name="id" value={t.id} /><Field label="Name" name="name" required defaultValue={t.name} /><div><label className="label" htmlFor={`b${t.id}`}>Text</label><textarea id={`b${t.id}`} name="body" rows={8} required defaultValue={t.body} className="input py-2" /></div>
            <div className="mt-3"><label className="label" htmlFor={`a${t.id}`}>Status</label><select id={`a${t.id}`} name="active" defaultValue={t.active ? 'yes' : 'no'} className="input"><option value="yes">Active</option><option value="no">Inactive</option></select></div></ActionForm></details>)}
      </div>
    );
  });
}
