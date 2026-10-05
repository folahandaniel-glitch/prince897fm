import Link from 'next/link';
import { page } from '@/server/session';
import { listTickets, ticketStats, STATUS_LABEL } from '@/server/tickets';
import { need } from '@/server/ctx';
import { Empty, PageHead, Stat } from '@/components/ui';

export const metadata = { title: 'Ticket queue' };
export const dynamic = 'force-dynamic';

export default async function Queue({ searchParams }: { searchParams: Promise<{ scope?: string; status?: string }> }) {
  const sp = await searchParams;
  return page(async (p) => {
    p.requireFeature('tickets');
    need(p.ctx, 'ticket:handle');
    const scope = sp.scope === 'assigned' ? 'assigned' : 'all';
    const [rows, st] = await Promise.all([listTickets(p.ctx, scope, sp.status ?? 'open'), ticketStats(p.ctx)]);
    const due = (d: any) => { const ms = new Date(d).getTime() - Date.now(); const h = Math.round(Math.abs(ms) / 36e5); return ms < 0 ? `${h}h overdue` : `${h}h left`; };
    return (
      <div className="space-y-5">
        <PageHead title="Ticket queue" sub="Soonest SLA first."><Link className="btn-ghost" href="?scope=all">All</Link><Link className="btn-ghost" href="?scope=assigned">Assigned to me</Link><Link className="btn-ghost" href="?status=all">Include closed</Link></PageHead>
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Open" value={st.open} /><Stat label="Past SLA" value={st.breached} /><Stat label="Solved (30 days)" value={st.solved30} /><Stat label="Satisfaction" value={st.csat ?? '-'} sub="out of 5" /></section>
        {rows.length === 0 ? <Empty title="Queue is clear" text="No tickets match this view." /> : <div className="card overflow-x-auto p-0"><table className="w-full min-w-[40rem]"><thead><tr className="border-b border-line"><th className="th">Ticket</th><th className="th">Requester</th><th className="th">Priority</th><th className="th">Status</th><th className="th">SLA</th><th className="th">Assigned</th></tr></thead>
          <tbody>{rows.map((t: any) => <tr key={t.id} className="border-b border-line last:border-0"><td className="td"><Link className="font-medium underline" href={`/tickets/${t.id}`}>{t.number}</Link> <span className="text-muted">{t.subject}</span></td><td className="td">{t.requester ?? t.account ?? 'Client'}</td><td className="td"><span className="badge">{t.priority}</span></td><td className="td"><span className="badge">{STATUS_LABEL[t.status]}</span></td><td className={`td ${t.breached ? 'font-semibold text-red-700 dark:text-red-400' : ''}`}>{t.sla_due_at ? due(t.sla_due_at) : '-'}</td><td className="td">{t.assignee ?? '-'}</td></tr>)}</tbody></table></div>}
      </div>
    );
  });
}
