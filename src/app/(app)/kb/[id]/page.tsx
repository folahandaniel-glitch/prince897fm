import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { page, mutate, field } from '@/server/session';
import { deleteArticle, getArticle, saveArticle } from '@/server/company';
import { ActionForm, Field } from '@/components/forms';
import { PageHead } from '@/components/ui';

export const dynamic = 'force-dynamic';

async function save(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/kb'], async (c) => { await saveArticle(c, { id: field(f, 'id'), title: field(f, 'title'), category: field(f, 'category'), body: field(f, 'body'), pinned: field(f, 'pinned') === 'yes', status: field(f, 'status') }); return 'Saved.'; });
}
async function remove(_p: unknown, f: FormData) {
  'use server';
  const r = await mutate(['/kb'], async (c) => { await deleteArticle(c, field(f, 'id')); });
  if (!r?.error) redirect('/kb');
  return r;
}

export default async function Article({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return page(async (p) => {
    const a = await getArticle(p.ctx, id);
    if (!a) notFound();
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHead title={a.title} sub={`${a.category} · updated ${new Date(a.updated_at).toLocaleDateString()}${a.author ? ` by ${a.author}` : ''}`}><Link href="/kb" className="btn-ghost">All articles</Link></PageHead>
        <article className="card whitespace-pre-wrap text-sm leading-relaxed">{a.body}</article>
        {p.allowed('kb:manage') && <details className="card"><summary className="cursor-pointer font-semibold">Edit this article</summary>
          <ActionForm action={save as any} submit="Save changes" className="mt-3"><input type="hidden" name="id" value={a.id} /><div className="grid gap-x-4 sm:grid-cols-2"><Field label="Title" name="title" required defaultValue={a.title} /><Field label="Category" name="category" defaultValue={a.category} /></div>
            <div><label className="label" htmlFor="body">Text</label><textarea id="body" name="body" rows={8} required defaultValue={a.body} className="input py-2" /></div>
            <div className="mt-3 grid gap-x-4 sm:grid-cols-2"><div><label className="label" htmlFor="status">Status</label><select id="status" name="status" defaultValue={a.status} className="input"><option value="published">Published</option><option value="draft">Draft</option></select></div>
              <div><label className="label" htmlFor="pinned">Pin to top</label><select id="pinned" name="pinned" defaultValue={a.pinned ? 'yes' : 'no'} className="input"><option value="no">No</option><option value="yes">Yes</option></select></div></div></ActionForm>
          <ActionForm action={remove as any} submit="Delete article" tone="danger" confirm="Delete this article for good?" className="mt-4"><input type="hidden" name="id" value={a.id} /></ActionForm></details>}
      </div>
    );
  });
}
