import Link from 'next/link';
import { page, mutate, field } from '@/server/session';
import { listPages, savePage } from '@/server/builders';
import type { Block } from '@/domain/builders';
import { need } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';
import { Empty, PageHead } from '@/components/ui';

export const metadata = { title: 'Pages' };
export const dynamic = 'force-dynamic';
const ROWS = 10;

async function save(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/builder/pages'], async (c) => {
    const blocks: Block[] = [];
    for (let i = 1; i <= ROWS; i++) {
      const t = field(f, `bt${i}`), text = field(f, `bx${i}`), href = field(f, `bh${i}`);
      if (!t || (!text && t !== 'divider')) continue;
      if (t === 'heading') blocks.push({ type: 'heading', text }); else if (t === 'text') blocks.push({ type: 'text', text }); else if (t === 'callout') blocks.push({ type: 'callout', text });
      else if (t === 'button') blocks.push({ type: 'button', label: text, href }); else if (t === 'image') blocks.push({ type: 'image', src: href, alt: text }); else if (t === 'divider') blocks.push({ type: 'divider' });
    }
    const slug = await savePage(c, { slug: field(f, 'slug'), title: field(f, 'title'), blocks, roles: field(f, 'who') === 'managers' ? ['hr_manager', 'department_head', 'executive', 'ceo', 'tenant_admin'] : ['*'], publish: field(f, 'intent') === 'publish' });
    return field(f, 'intent') === 'publish' ? `Published at /p/${slug}.` : 'Saved as a draft (not visible to staff).';
  });
}

export default async function Pages() {
  return page(async (p) => {
    p.requireFeature('builders');
    need(p.ctx, 'builder:manage');
    const pages = await listPages(p.ctx.q);
    return (
      <div className="space-y-5">
        <PageHead title="Pages" sub="Information pages for staff: notices, procedures, links. Drafts are private; every save keeps a version."><Link className="btn-ghost" href="/builder">← Builder</Link></PageHead>
        {pages.length === 0 ? <Empty title="No pages yet" /> : <ul className="grid gap-3 sm:grid-cols-2">{pages.map((x: any) => <li key={x.id} className="card"><p className="font-semibold">{x.title} {!x.published && <span className="badge">draft</span>}</p><p className="text-xs text-muted">/p/{x.slug} · version {x.version}</p><Link className="btn-ghost mt-2" href={`/p/${x.slug}`}>Open</Link></li>)}</ul>}
        <section className="card"><h2 className="font-semibold">Create or update a page</h2>
          <ActionForm action={save as any} submit="Save draft" buttons={[{ label: 'Save draft', value: 'draft', tone: 'ghost' }, { label: 'Publish', value: 'publish' }]} className="mt-3">
            <div className="grid gap-x-4 sm:grid-cols-3"><Field label="Title" name="title" required /><Field label="Web address name" name="slug" required hint="Using an existing name updates that page." /><Select label="Who can read it" name="who" allowEmpty={false} defaultValue="all" options={[{ value: 'all', label: 'All staff' }, { value: 'managers', label: 'Managers only' }]} /></div>
            {Array.from({ length: ROWS }, (_, i) => <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[8rem_1fr_1fr]"><select name={`bt${i + 1}`} aria-label={`Block ${i + 1} type`} className="input" defaultValue="">{['', 'heading', 'text', 'callout', 'button', 'image', 'divider'].map((t) => <option key={t} value={t}>{t || '— none —'}</option>)}</select><input name={`bx${i + 1}`} aria-label={`Block ${i + 1} text`} className="input" placeholder="Text / button label / image description" /><input name={`bh${i + 1}`} aria-label={`Block ${i + 1} link`} className="input" placeholder="Link or image address (/path or https://)" /></div>)}
          </ActionForm></section>
      </div>
    );
  });
}
