import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page, mutate, field } from '@/server/session';
import { getThread, move, send } from '@/server/mail';
import { ActionForm } from '@/components/forms';
import { PageHead } from '@/components/ui';

export const dynamic = 'force-dynamic';
async function reply(_p: unknown, f: FormData) {
  'use server';
  const t = field(f, 'thread');
  return mutate([`/mail/${t}`, '/mail'], async (c) => { await send(c, { to: f.getAll('to').map(String), subject: field(f, 'subject'), body: field(f, 'body'), threadId: t }); return 'Reply sent.'; });
}
async function file(_p: unknown, f: FormData) { 'use server'; const t = field(f, 'thread'); return mutate([`/mail/${t}`, '/mail'], async (c) => { await move(c, t, field(f, 'intent') as any); return 'Moved.'; }); }

export default async function Thread({ params }: { params: Promise<{ thread: string }> }) {
  const { thread } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(thread)) notFound();
  return page(async (p) => {
    p.requireFeature('mail');
    const t = await getThread(p.ctx, thread);
    if (!t) notFound();
    const last = t.msgs[t.msgs.length - 1];
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <nav className="text-sm text-muted" aria-label="Breadcrumb"><Link className="underline" href="/mail">Mail</Link> / {last.subject}</nav>
        <PageHead title={last.subject} sub={`With ${t.parties.map((x: any) => x.name).join(', ')}`} />
        <section className="space-y-3">{t.msgs.map((m: any) => (
          <article key={m.id} className="card"><p className="text-xs text-muted"><strong className="text-ink">{m.sender}</strong> to {m.to_names} · {new Date(m.created_at).toLocaleString(p.org.locale, { timeZone: p.org.timezone })}{m.priority === 'high' ? ' · high priority' : ''}</p><p className="mt-2 whitespace-pre-wrap text-sm">{m.body}</p></article>))}</section>
        <section className="card"><ActionForm action={reply as any} submit="Send reply"><input type="hidden" name="thread" value={thread} /><input type="hidden" name="subject" value={last.subject.startsWith('Re:') ? last.subject : `Re: ${last.subject}`} />
          {t.parties.map((x: any) => <input key={x.id} type="hidden" name="to" value={x.id} />)}
          <div><label className="label" htmlFor="body">Reply to everyone</label><textarea id="body" name="body" rows={4} required className="input py-2" /></div></ActionForm></section>
        <ActionForm action={file as any} submit="Archive" tone="ghost" buttons={[{ label: 'Archive', value: 'archive', tone: 'ghost' }, { label: 'Move to trash', value: 'trash', tone: 'ghost' }, { label: 'Back to inbox', value: 'inbox', tone: 'ghost' }]}><input type="hidden" name="thread" value={thread} /></ActionForm>
      </div>
    );
  });
}
