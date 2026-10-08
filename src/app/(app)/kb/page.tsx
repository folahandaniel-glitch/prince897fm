import Link from 'next/link';
import { page, mutate, field } from '@/server/session';
import { listArticles, saveArticle } from '@/server/company';
import { ActionForm, Field } from '@/components/forms';
import { PageHead, Empty } from '@/components/ui';

export const metadata = { title: 'Knowledge base' };
export const dynamic = 'force-dynamic';

async function save(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/kb'], async (c) => { await saveArticle(c, { title: field(f, 'title'), category: field(f, 'category'), body: field(f, 'body'), pinned: field(f, 'pinned') === 'yes', status: field(f, 'status') }); return 'Saved.'; });
}

export default async function KB({ searchParams }: { searchParams: Promise<{ q?: string; c?: string }> }) {
  const sp = await searchParams;
  return page(async (p) => {
    const rows = await listArticles(p.ctx, { q: sp.q, category: sp.c });
    const cats = [...new Set(rows.map((r: any) => r.category))] as string[];
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <PageHead title="Knowledge base" sub="Procedures, policies and how-tos for the station." />
        <form className="flex gap-2" role="search"><input name="q" defaultValue={sp.q} placeholder="Search articles" className="input" aria-label="Search articles" /><button className="btn-primary">Search</button>{(sp.q || sp.c) && <Link className="btn-ghost" href="/kb">Clear</Link>}</form>
        {cats.length > 1 && <div className="flex flex-wrap gap-2">{cats.map((x) => <Link key={x} href={`?c=${encodeURIComponent(x)}`} className="btn-ghost">{x}</Link>)}</div>}
        {rows.length === 0 ? <Empty title="No articles found" /> : <ul className="space-y-2">{rows.map((a: any) => (
          <li key={a.id}><Link href={`/kb/${a.id}`} className="card block !p-4 hover:border-brand"><p className="font-medium">{a.pinned ? '📌 ' : ''}{a.title}{a.status === 'draft' && <span className="badge ml-2">draft</span>}</p><p className="text-xs text-muted">{a.category}</p><p className="mt-1 line-clamp-2 text-sm text-muted">{a.excerpt}</p></Link></li>))}</ul>}
        {p.allowed('kb:manage') && <section className="card"><h2 className="font-semibold">Write an article</h2>
          <ActionForm action={save as any} submit="Save article" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-2"><Field label="Title" name="title" required /><Field label="Category" name="category" placeholder="General" /></div>
            <div><label className="label" htmlFor="body">Text</label><textarea id="body" name="body" rows={8} required className="input py-2" /></div>
            <div className="mt-3 grid gap-x-4 sm:grid-cols-2"><div><label className="label" htmlFor="status">Status</label><select id="status" name="status" className="input"><option value="published">Published</option><option value="draft">Draft (only editors see it)</option></select></div>
              <div><label className="label" htmlFor="pinned">Pin to top</label><select id="pinned" name="pinned" className="input"><option value="no">No</option><option value="yes">Yes</option></select></div></div></ActionForm></section>}
      </div>
    );
  });
}
