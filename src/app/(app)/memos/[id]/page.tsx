import { notFound } from 'next/navigation';
import { page, mutate, field } from '@/server/session';
import { acknowledge, ackStatus, getMemo } from '@/server/company';
import { ActionForm } from '@/components/forms';
import { PageHead } from '@/components/ui';

export const dynamic = 'force-dynamic';

async function ack(_p: unknown, f: FormData) { 'use server'; return mutate(['/memos'], async (c) => { await acknowledge(c, field(f, 'id')); return 'Thank you. Recorded.'; }); }

export default async function MemoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return page(async (p) => {
    const m = await getMemo(p.ctx, id);
    if (!m) notFound();
    const status = p.allowed('memo:post') ? await ackStatus(p.ctx, id) : null;
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHead title={m.title} sub={`${m.ref} · from ${m.author} · ${new Date(m.created_at).toLocaleDateString()}`} />
        <article className="card whitespace-pre-wrap text-sm leading-relaxed">{m.body}</article>
        {m.require_ack && !m.my_ack && m.created_by !== p.ctx.userId && <ActionForm action={ack as any} submit="I have read this memo"><input type="hidden" name="id" value={m.id} /></ActionForm>}
        {m.my_ack && <p className="text-sm text-emerald-700">You acknowledged this memo on {new Date(m.my_ack).toLocaleString()}.</p>}
        {status && m.require_ack && <section className="card"><h2 className="font-semibold">Acknowledgements ({status.filter((s) => s.ackedAt).length}/{status.length})</h2>
          <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">{status.map((s) => <li key={s.id} className="flex justify-between gap-2"><span>{s.name}</span><span className={s.ackedAt ? 'text-emerald-700' : 'text-amber-700'}>{s.ackedAt ? 'Read' : 'Not yet'}</span></li>)}</ul></section>}
      </div>
    );
  });
}
