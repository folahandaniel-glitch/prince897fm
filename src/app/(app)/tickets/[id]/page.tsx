import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page, mutate, field, optional } from '@/server/session';
import { comment, getTicket, rate, setStatus, STATUS_LABEL } from '@/server/tickets';
import { ActionForm, Field, Select } from '@/components/forms';
import { Notice, PageHead } from '@/components/ui';

export const dynamic = 'force-dynamic';
const paths = (id: string) => [`/tickets/${id}`, '/tickets', '/tickets/queue'];
async function reply(_p: unknown, f: FormData) { 'use server'; const id = field(f, 'id'); return mutate(paths(id), async (c) => { await comment(c, id, field(f, 'body'), field(f, 'intent') === 'internal'); return 'Sent.'; }); }
async function status(_p: unknown, f: FormData) { 'use server'; const id = field(f, 'id'); return mutate(paths(id), async (c) => { await setStatus(c, id, field(f, 'status'), optional(f, 'assignee')); return 'Updated.'; }); }
async function score(_p: unknown, f: FormData) { 'use server'; const id = field(f, 'id'); return mutate(paths(id), async (c) => { await rate(c, id, Number(field(f, 'score'))); return 'Thank you for the feedback.'; }); }

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return page(async (p) => {
    p.requireFeature('tickets');
    const d = await getTicket(p.ctx, id);
    if (!d) notFound();
    const { t, comments, handler, handlers, isRequester } = d;
    const fmt = (x: any) => new Date(x).toLocaleString(p.org.locale, { timeZone: p.org.timezone });
    const breached = t.sla_due_at && new Date(t.sla_due_at) < new Date() && !['resolved', 'closed'].includes(t.status);
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <nav className="text-sm text-muted" aria-label="Breadcrumb"><Link className="underline" href={handler ? '/tickets/queue' : '/tickets'}>Support</Link> / {t.number}</nav>
        <PageHead title={t.subject} sub={`${t.category ?? 'General'} · ${t.requester ?? t.requester_name ?? t.account ?? ''} · opened ${fmt(t.created_at)}`}><span className="badge">{t.priority}</span><span className="badge text-sm">{STATUS_LABEL[t.status]}</span></PageHead>
        {breached && <Notice tone="bad">This ticket is past its response target ({fmt(t.sla_due_at)}).</Notice>}
        <section className="card"><p className="whitespace-pre-wrap text-sm">{t.description}</p>{t.sla_due_at && <p className="mt-3 text-xs text-muted">Target: {fmt(t.sla_due_at)}{t.assignee ? ` · assigned to ${t.assignee}` : ''}</p>}</section>
        <section className="space-y-3" aria-label="Conversation">{comments.map((c: any) => <article key={c.id} className={`card !p-4 ${c.internal ? 'border-amber-400 bg-amber-50 dark:bg-amber-950' : ''}`}><p className="text-xs text-muted">{c.author} · {fmt(c.created_at)}{c.internal ? ' · INTERNAL NOTE (not visible to the requester)' : ''}</p><p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p></article>)}</section>
        {t.status !== 'closed' && <section className="card"><ActionForm action={reply as any} submit="Reply" buttons={handler ? [{ label: 'Reply to requester', value: 'reply' }, { label: 'Add internal note', value: 'internal', tone: 'ghost' }] : [{ label: 'Reply', value: 'reply' }]}><input type="hidden" name="id" value={id} /><div><label className="label" htmlFor="body">Message</label><textarea id="body" name="body" rows={3} required className="input py-2" /></div></ActionForm></section>}
        {handler && <section className="card"><h2 className="font-semibold">Update ticket</h2><ActionForm action={status as any} submit="Update" className="mt-2"><input type="hidden" name="id" value={id} /><div className="grid gap-x-4 sm:grid-cols-2"><Select label="Status" name="status" allowEmpty={false} defaultValue={t.status} options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))} /><Select label="Assign to" name="assignee" defaultValue={t.assignee_user_id} options={handlers.map((h: any) => ({ value: h.id, label: h.email }))} /></div></ActionForm></section>}
        {isRequester && ['resolved', 'closed'].includes(t.status) && !t.satisfaction && <section className="card"><h2 className="font-semibold">How did we do?</h2><ActionForm action={score as any} submit="Send rating" className="mt-2"><input type="hidden" name="id" value={id} /><Select label="Rating" name="score" allowEmpty={false} defaultValue="5" options={[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} ${n === 5 ? '(excellent)' : n === 1 ? '(poor)' : ''}` }))} /></ActionForm></section>}
        <p className="hidden"><Field label="" name="y" /></p>
      </div>
    );
  });
}
