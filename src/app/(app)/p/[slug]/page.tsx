import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page } from '@/server/session';
import { getPageForView } from '@/server/builders';
import { safeHref, type Block } from '@/domain/builders';
import { PageHead } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Builder content is rendered as plain React text: nothing from a page is ever treated as HTML or script. */
function BlockView({ b }: { b: Block }) {
  switch (b.type) {
    case 'heading': return <h2 className="mt-6 text-xl font-bold">{b.text}</h2>;
    case 'text': return <p className="whitespace-pre-wrap leading-relaxed">{b.text}</p>;
    case 'callout': return <p className="rounded-xl border-l-4 border-accent bg-surface px-4 py-3">{b.text}</p>;
    case 'divider': return <hr className="border-line" />;
    case 'button': return safeHref(b.href) ? (b.href.startsWith('/') ? <Link className="btn-primary" href={b.href}>{b.label}</Link> : <a className="btn-primary" href={b.href} rel="noopener noreferrer" target="_blank">{b.label}</a>) : null;
    case 'image': return safeHref(b.src) ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={b.src} alt={b.alt} className="max-h-96 rounded-xl" loading="lazy" /> : null;
    default: return null;
  }
}

export default async function InfoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return page(async (p) => {
    p.requireFeature('builders');
    const d = await getPageForView(p.ctx, slug);
    if (!d) notFound();
    return (
      <article className="mx-auto max-w-3xl space-y-4">
        <PageHead title={d.title} sub={d.published ? undefined : 'Draft: only builders can see this'}>{d.canEdit && <Link className="btn-ghost" href="/builder/pages">Edit</Link>}</PageHead>
        <div className="space-y-4">{(d.blocks as Block[]).map((b, i) => <BlockView key={i} b={b} />)}</div>
      </article>
    );
  });
}
