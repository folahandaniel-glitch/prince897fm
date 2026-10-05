import { page, mutate, field } from '@/server/session';
import { configHistory, getDraft, publishDraft, rollbackTo, saveDraft } from '@/server/config';
import { need } from '@/server/ctx';
import { DEFAULT_TERMS, type Branding, type Terminology } from '@/domain/config-schema';
import { ActionForm, Field } from '@/components/forms';

export const metadata = { title: 'Branding & labels' };
export const dynamic = 'force-dynamic';

async function brandingAction(_p: unknown, f: FormData) {
  'use server';
  const publish = field(f, 'intent') === 'publish';
  return mutate(['/admin/config', '/dashboard', '/employees'], async (c) => {
    await saveDraft(c, 'branding', {
      name: field(f, 'name'), shortName: field(f, 'shortName'), tagline: field(f, 'tagline'),
      primary: field(f, 'primary'), secondary: field(f, 'secondary'), accent: field(f, 'accent'), logoUrl: '', footer: field(f, 'footer'),
    });
    if (publish) { await publishDraft(c, 'branding', field(f, 'note') || undefined); return 'Published. Everyone sees the new branding now.'; }
    return 'Draft saved. Publish when ready.';
  });
}

async function termsAction(_p: unknown, f: FormData) {
  'use server';
  const publish = field(f, 'intent') === 'publish';
  return mutate(['/admin/config', '/dashboard', '/employees', '/admin/structure'], async (c) => {
    const terms: Terminology = {};
    for (const k of Object.keys(DEFAULT_TERMS)) terms[k] = { singular: field(f, `${k}.s`) || DEFAULT_TERMS[k].singular, plural: field(f, `${k}.p`) || DEFAULT_TERMS[k].plural };
    await saveDraft(c, 'terminology', terms);
    if (publish) { await publishDraft(c, 'terminology', field(f, 'note') || undefined); return 'Published. Labels updated across the app.'; }
    return 'Draft saved. Publish when ready.';
  });
}

async function rollback(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/admin/config', '/dashboard', '/employees'], async (c) => {
    await rollbackTo(c, field(f, 'kind') as any, field(f, 'versionId'), field(f, 'reason'));
    return 'Rolled back by publishing the earlier version as a new version.';
  });
}

export default async function ConfigPage() {
  return page(async (p) => {
    need(p.ctx, 'config:manage');
    const bDraft = (await getDraft<Branding>(p.ctx.q, 'branding')) ?? p.branding;
    const tDraft = (await getDraft<Terminology>(p.ctx.q, 'terminology')) ?? p.terms;
    const bHist = await configHistory(p.ctx.q, 'branding');
    const tHist = await configHistory(p.ctx.q, 'terminology');
    const canRollback = p.allowed('config:rollback');
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Branding &amp; labels</h1>
        <p className="text-sm text-muted">Save a draft, review it, then publish. Every publish is versioned and can be rolled back. Colours are checked for readability.</p>

        <section className="card" aria-labelledby="b-h">
          <h2 id="b-h" className="font-semibold">Branding</h2>
          <ActionForm action={brandingAction as any} submit="Save draft" tone="ghost" className="mt-3">
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field label="Organisation name" name="name" required defaultValue={bDraft.name} />
              <Field label="Short name (app icon, mobile header)" name="shortName" required defaultValue={bDraft.shortName} />
              <Field label="Tagline" name="tagline" defaultValue={bDraft.tagline} />
              <Field label="Footer text" name="footer" required defaultValue={bDraft.footer} />
              <Field label="Primary colour" name="primary" required defaultValue={bDraft.primary} hint="Hex, e.g. #12284C. White text must stay readable on it." />
              <Field label="Secondary colour" name="secondary" required defaultValue={bDraft.secondary} />
              <Field label="Accent colour" name="accent" required defaultValue={bDraft.accent} />
              <Field label="Publish note (optional)" name="note" />
            </div>
            <label className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" name="intent" value="publish" className="h-5 w-5" /> Publish immediately after saving</label>
          </ActionForm>
        </section>

        <section className="card" aria-labelledby="t-h">
          <h2 id="t-h" className="font-semibold">Terminology</h2>
          <p className="text-sm text-muted">Rename what your organisation calls things. The underlying data does not change.</p>
          <ActionForm action={termsAction as any} submit="Save draft" tone="ghost" className="mt-3">
            <div className="grid gap-x-4 sm:grid-cols-2">{Object.keys(DEFAULT_TERMS).map((k) => (
              <fieldset key={k} className="mb-3 grid grid-cols-2 gap-2"><legend className="label capitalize">{k.replace('_', ' ')}</legend>
                <input aria-label={`${k} singular`} name={`${k}.s`} defaultValue={tDraft[k]?.singular} className="input" />
                <input aria-label={`${k} plural`} name={`${k}.p`} defaultValue={tDraft[k]?.plural} className="input" /></fieldset>))}</div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="intent" value="publish" className="h-5 w-5" /> Publish immediately after saving</label>
          </ActionForm>
        </section>

        {canRollback && [['branding', bHist], ['terminology', tHist]].map(([kind, hist]: any) => (
          <section key={kind} className="card" aria-label={`${kind} versions`}>
            <h2 className="font-semibold capitalize">{kind} versions</h2>
            <ul className="mt-2 divide-y divide-line text-sm">{hist.map((h: any) => (
              <li key={h.id} className="py-2"><div className="flex flex-wrap items-center justify-between gap-2"><span>v{h.version} <span className="badge">{h.status}</span> <span className="text-muted">{h.note ?? ''}</span></span>
                {h.status === 'superseded' && (
                  <details><summary className="cursor-pointer text-xs underline">Roll back to this</summary>
                    <ActionForm action={rollback as any} submit="Roll back" tone="danger" className="mt-2 w-64" confirm="Publish this older version as the current one?">
                      <input type="hidden" name="kind" value={kind} /><input type="hidden" name="versionId" value={h.id} /><Field label="Reason" name="reason" required /></ActionForm></details>)}</div></li>))}</ul>
          </section>))}
      </div>
    );
  });
}
