import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page, mutate, field } from '@/server/session';
import { addVersion, archiveDocument, getDocument } from '@/server/documents';
import { UserError } from '@/server/ctx';
import { ActionForm, Field } from '@/components/forms';
import { PageHead } from '@/components/ui';

export const dynamic = 'force-dynamic';
async function version(_p: unknown, f: FormData) {
  'use server';
  const id = field(f, 'id'); const file = f.get('file');
  return mutate([`/documents/${id}`, '/documents'], async (c) => { if (!(file instanceof File) || file.size === 0) throw new UserError('Choose a file.'); await addVersion(c, id, file.name, Buffer.from(await file.arrayBuffer()), field(f, 'note')); return 'New version added. Earlier versions are kept.'; });
}
async function archive(_p: unknown, f: FormData) { 'use server'; const id = field(f, 'id'); return mutate([`/documents/${id}`, '/documents'], async (c) => { await archiveDocument(c, id, field(f, 'reason')); return 'Archived.'; }); }

export default async function DocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return page(async (p) => {
    p.requireFeature('documents');
    const d = await getDocument(p.ctx, id);
    if (!d) notFound();
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <nav className="text-sm text-muted" aria-label="Breadcrumb"><Link className="underline" href="/documents">Documents</Link> / {d.d.title}</nav>
        <PageHead title={d.d.title} sub={`${d.d.category} · ${d.d.sensitivity} · owner ${d.d.owner}${d.d.expires ? ` · expires ${d.d.expires}` : ''}`}><a className="btn-primary" href={`/api/documents/${id}`}>Download latest</a></PageHead>
        {d.d.description && <p className="card text-sm">{d.d.description}</p>}
        <section className="card"><h2 className="font-semibold">Versions</h2><ul className="mt-2 divide-y divide-line text-sm">{d.versions.map((v: any) => <li key={v.version} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>v{v.version} · {v.filename} · {Math.round(v.size_bytes / 1024)} KB<span className="block text-xs text-muted">{v.by} · {new Date(v.created_at).toLocaleDateString(p.org.locale)}{v.note ? ` · ${v.note}` : ''} · fingerprint {v.sha256.slice(0, 10)}…</span></span><a className="underline" href={`/api/documents/${id}?v=${v.version}`}>Download</a></li>)}</ul></section>
        {d.canManage && <>
          <section className="card"><h2 className="font-semibold">Upload a new version</h2><ActionForm action={version as any} submit="Upload version" className="mt-2"><input type="hidden" name="id" value={id} /><div><label className="label" htmlFor="file">File</label><input id="file" name="file" type="file" required className="input py-2" /></div><Field label="What changed" name="note" /></ActionForm></section>
          <section className="card"><h2 className="font-semibold">Archive</h2><ActionForm action={archive as any} submit="Archive" tone="danger" className="mt-2" confirm="Archive this document?"><input type="hidden" name="id" value={id} /><Field label="Reason" name="reason" required /></ActionForm></section></>}
      </div>
    );
  });
}
