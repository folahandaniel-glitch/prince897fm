import Link from 'next/link';
import { page, mutate, field, optional } from '@/server/session';
import { createTicket, listCategories, listTickets, STATUS_LABEL } from '@/server/tickets';
import { ActionForm, Field, Select } from '@/components/forms';
import { Empty, PageHead } from '@/components/ui';

export const metadata = { title: 'Support' };
export const dynamic = 'force-dynamic';

async function create(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/tickets', '/tickets/queue'], async (c) => { const r = await createTicket(c, { subject: field(f, 'subject'), description: field(f, 'description'), categoryId: optional(f, 'categoryId') ?? undefined, priority: field(f, 'priority') }); return `${r.number} created. You will be notified when support replies.`; });
}
const PRIORITY_TONE: Record<string, string> = { urgent: 'bg-red-100 text-red-900', high: 'bg-amber-100 text-amber-900', normal: '', low: '' };

export default async function Support() {
  return page(async (p) => {
    p.requireFeature('tickets');
    const [mine, cats] = await Promise.all([listTickets(p.ctx, 'mine'), listCategories(p.ctx.q)]);
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <PageHead title="Support" sub="Report a fault or ask for help. We aim to respond within the time shown for each category.">{p.allowed('ticket:handle') && <Link className="btn-ghost" href="/tickets/queue">Ticket queue</Link>}</PageHead>
        <section className="card" aria-labelledby="new"><h2 id="new" className="font-semibold">New ticket</h2>
          <ActionForm action={create as any} submit="Send ticket" className="mt-3"><Field label="Subject" name="subject" required placeholder="e.g. Studio 2 microphone has no signal" />
            <div className="grid gap-x-4 sm:grid-cols-2"><Select label="Category" name="categoryId" options={cats.map((c: any) => ({ value: c.id, label: `${c.name} (reply within ${c.sla_hours}h)` }))} /><Select label="How urgent?" name="priority" allowEmpty={false} defaultValue="normal" options={[{ value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent: stopping work or broadcast' }]} /></div>
            <div className="mb-1"><label className="label" htmlFor="description">What is happening?</label><textarea id="description" name="description" rows={4} required minLength={10} className="input py-2" /></div></ActionForm></section>
        <section aria-labelledby="my"><h2 id="my" className="mb-2 font-semibold">My tickets</h2>
          {mine.length === 0 ? <Empty title="No tickets yet" text="Anything you report will appear here." /> : <ul className="space-y-2">{mine.map((t: any) => <li key={t.id}><Link href={`/tickets/${t.id}`} className="card flex flex-wrap items-center justify-between gap-2 !p-4 hover:border-brand"><span><span className="font-medium">{t.subject}</span><span className="block text-xs text-muted">{t.number} · {t.category ?? 'General'}</span></span><span className="flex gap-1"><span className={`badge ${PRIORITY_TONE[t.priority]}`}>{t.priority}</span><span className="badge">{STATUS_LABEL[t.status]}</span></span></Link></li>)}</ul>}</section>
      </div>
    );
  });
}
