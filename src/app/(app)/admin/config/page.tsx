import { page, mutate, field } from '@/server/session';
import { configHistory, getDraft, publishDraft, resolveConfig, rollbackTo, saveDraft } from '@/server/config';
import { saveBrandImage } from '@/server/brand';
import { need, UserError } from '@/server/ctx';
import { DEFAULT_TERMS, type Branding, type Terminology } from '@/domain/config-schema';
import { ActionForm, Field } from '@/components/forms';

export const metadata = { title: 'Branding & labels' };
export const dynamic = 'force-dynamic';

async function brandingAction(_p: unknown, f: FormData) {
  'use server';
  const publish = field(f, 'intent') === 'publish';
  return mutate(['/admin/config', '/dashboard', '/employees'], async (c) => {
    // Start from the current branding so the logo, emblem and app icons are kept; only the edited fields change.
    const base = (await getDraft<Branding>(c.q, 'branding')) ?? (await resolveConfig(c.q, c.orgId)).branding;
    await saveDraft(c, 'branding', {
      ...base,
      name: field(f, 'name'), shortName: field(f, 'shortName'), tagline: field(f, 'tagline'),
      primary: field(f, 'primary'), secondary: field(f, 'secondary'), accent: field(f, 'accent'), footer: field(f, 'footer'),
    });
    if (publish) { await publishDraft(c, 'branding', field(f, 'note') || undefined); return 'Published. Everyone sees the new branding now.'; }
    return 'Draft saved. Publish when ready.';
  });
}

async function imageAction(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/admin/config'], async (c) => {
    let n = 0;
    for (const kind of ['logo', 'mark'] as const) {
      const file = f.get(kind);
      if (file instanceof File && file.size > 0) { await saveBrandImage(c, kind, Buffer.from(await file.arrayBuffer())); n++; }
    }
    if (!n) throw new UserError('Choose an image to upload.');
    return 'Uploaded into the branding draft. Publish the draft to show it to everyone.';
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

        <section className="card" aria-labelledby="i-h">
          <h2 id="i-h" className="font-semibold">Logo and emblem</h2>
          <p className="text-sm text-muted">PNG, JPEG or WebP up to 1 MB. The logo is the wide version (sign-in page, sidebar); the emblem is the small square one (mobile header). Uploads go into the branding draft: publish it above to go live.</p>
          <div className="mt-3 flex flex-wrap items-center gap-4">{bDraft.logoUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={bDraft.logoUrl} alt="Current logo" className="h-12 w-auto rounded bg-[#111] p-1" />}{bDraft.markUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={bDraft.markUrl} alt="Current emblem" className="h-12 w-auto rounded bg-[#111] p-1" />}</div>
          <ActionForm action={imageAction as any} submit="Upload" tone="ghost" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-2"><div className="mb-3"><label className="label" htmlFor="logo">Logo (wide)</label><input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" className="input py-2" /></div><div className="mb-3"><label className="label" htmlFor="mark">Emblem (square)</label><input id="mark" name="mark" type="file" accept="image/png,image/jpeg,image/webp" className="input py-2" /></div></div></ActionForm>
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
