import Link from 'next/link';
import { page, mutate, field } from '@/server/session';
import { CATEGORIES, listDocuments, uploadDocument } from '@/server/documents';
import { UserError } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';
import { Empty, PageHead } from '@/components/ui';

export const metadata = { title: 'Documents' };
export const dynamic = 'force-dynamic';

async function upload(_p: unknown, f: FormData) {
  'use server';
  const file = f.get('file');
  return mutate(['/documents'], async (c) => {
    if (!(file instanceof File) || file.size === 0) throw new UserError('Choose a file.');
    const roles = field(f, 'roles') === 'managers' ? ['hr_manager', 'executive', 'ceo', 'tenant_admin'] : ['*'];
    await uploadDocument(c, { title: field(f, 'title'), category: field(f, 'category'), description: field(f, 'description'), sensitivity: field(f, 'sensitivity'), roles, expiresOn: field(f, 'expires') || undefined, filename: file.name, data: Buffer.from(await file.arrayBuffer()) });
    return 'Uploaded.';
  });
}

export default async function Documents({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  const sp = await searchParams;
  return page(async (p) => {
    p.requireFeature('documents');
    const docs = await listDocuments(p.ctx, { q: sp.q, category: sp.category });
    const soon = (d: any) => d.expires && new Date(d.expires) < new Date(Date.now() + 30 * 86_400_000);
    return (
      <div className="space-y-5">
        <PageHead title="Documents" sub="Policies, contracts, licences and records. Versioned, access-controlled, and every download is logged." />
        <form className="flex flex-wrap items-end gap-2" role="search"><div><label className="label" htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q} className="input" /></div><div><label className="label" htmlFor="cat">Category</label><select id="cat" name="category" defaultValue={sp.category ?? ''} className="input"><option value="">All</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div><button className="btn-ghost">Filter</button></form>
        {docs.length === 0 ? <Empty title="No documents" text="Nothing here matches, or nothing has been shared with you yet." /> : (
          <ul className="grid gap-3 sm:grid-cols-2">{docs.map((d: any) => (
            <li key={d.id}><Link href={`/documents/${d.id}`} className="card block hover:border-brand"><p className="font-semibold">{d.title}</p><p className="text-xs text-muted">{d.category} · v{d.current_version} · {d.filename}</p>
              <p className="mt-2 flex flex-wrap gap-1"><span className="badge">{d.sensitivity}</span>{d.expires && <span className={`badge ${soon(d) ? 'bg-amber-100 text-amber-900' : ''}`}>expires {d.expires}</span>}</p></Link></li>))}</ul>)}
        {p.allowed('doc:upload') && <section className="card" aria-labelledby="up"><h2 id="up" className="font-semibold">Upload a document</h2>
          <ActionForm action={upload as any} submit="Upload" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-2"><Field label="Title" name="title" required /><Select label="Category" name="category" allowEmpty={false} defaultValue="General" options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
            <Select label="Sensitivity" name="sensitivity" allowEmpty={false} defaultValue="internal" options={[{ value: 'public', label: 'Public' }, { value: 'internal', label: 'Internal' }, { value: 'confidential', label: 'Confidential' }]} /><Select label="Who can open it" name="roles" allowEmpty={false} defaultValue="all" options={[{ value: 'all', label: 'All staff' }, { value: 'managers', label: 'HR, executives and administrators only' }]} />
            <Field label="Expiry date (optional)" name="expires" type="date" hint="You are reminded 30 days before." /><Field label="Description" name="description" /></div>
            <div><label className="label" htmlFor="file">File (PDF, image, Word, Excel or PowerPoint, up to 5 MB)</label><input id="file" name="file" type="file" required className="input py-2" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.pptx" /></div></ActionForm></section>}
      </div>
    );
  });
}
