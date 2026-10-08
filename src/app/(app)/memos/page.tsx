import Link from 'next/link';
import { page, mutate, field } from '@/server/session';
import { listMemos, postMemo } from '@/server/company';
import { ActionForm, Field } from '@/components/forms';
import { PageHead, Empty } from '@/components/ui';

export const metadata = { title: 'Memos' };
export const dynamic = 'force-dynamic';

async function post(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/memos'], async (c) => { const r = await postMemo(c, { title: field(f, 'title'), body: field(f, 'body'), requireAck: field(f, 'ack') !== 'no' }); return `Sent as ${r.ref}.`; });
}

export default async function Memos() {
  return page(async (p) => {
    const rows = await listMemos(p.ctx);
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <PageHead title="Memos" sub="Formal notices from management. Open each one and confirm you have read it." />
        {rows.length === 0 ? <Empty title="No memos" /> : <ul className="space-y-2">{rows.map((m: any) => (
          <li key={m.id}><Link href={`/memos/${m.id}`} className="card flex flex-wrap items-center justify-between gap-2 !p-4 hover:border-brand"><span><span className="text-xs text-muted">{m.ref} · {new Date(m.created_at).toLocaleDateString()}</span><span className="block font-medium">{m.title}</span><span className="text-xs text-muted">From {m.author}</span></span>
            {m.require_ack && (m.my_ack ? <span className="badge bg-emerald-100 text-emerald-900">Read</span> : <span className="badge bg-amber-100 text-amber-900">Please acknowledge</span>)}</Link></li>))}</ul>}
        {p.allowed('memo:post') && <section className="card"><h2 className="font-semibold">Send a memo to all staff</h2>
          <ActionForm action={post as any} submit="Send memo" className="mt-3"><Field label="Title" name="title" required /><div><label className="label" htmlFor="body">Message</label><textarea id="body" name="body" rows={6} required className="input py-2" /></div>
            <div className="mt-3"><label className="label" htmlFor="ack">Acknowledgement</label><select id="ack" name="ack" className="input"><option value="yes">Everyone must confirm they have read it</option><option value="no">Information only</option></select></div></ActionForm></section>}
      </div>
    );
  });
}
