import Link from 'next/link';
import { page } from '@/server/session';
import { KIND_LABEL, listCases } from '@/server/discipline';
import { Empty, Notice, PageHead } from '@/components/ui';

export const metadata = { title: 'Warnings & queries' };
export const dynamic = 'force-dynamic';

const TONE: Record<string, string> = { query: 'bg-amber-100 text-amber-900', verbal_warning: 'bg-orange-100 text-orange-900', written_warning: 'bg-red-100 text-red-900', final_warning: 'bg-red-200 text-red-950', suspension: 'bg-red-200 text-red-950', fine: 'bg-red-100 text-red-900', commendation: 'bg-emerald-100 text-emerald-900' };

export default async function MyDiscipline() {
  return page(async (p) => {
    p.requireFeature('discipline');
    const mine = await listCases(p.ctx, 'mine');
    const waiting = mine.filter((c: any) => c.kind === 'query' && c.status === 'issued');
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHead title="Warnings & queries" sub="Matters recorded about you. You always have the right to read them and to respond before any decision is made.">
          {p.allowed('discipline:raise') && <Link href="/discipline/cases" className="btn-ghost">Manage cases</Link>}
        </PageHead>
        {waiting.length > 0 && <Notice tone="warn">You have {waiting.length} query waiting for your response. Please answer before the deadline shown.</Notice>}
        {mine.length === 0 ? <Empty title="Nothing recorded" text="Queries, warnings and commendations about you will appear here, and you will be notified." /> : (
          <ul className="space-y-3">{mine.map((c: any) => (
            <li key={c.id}><Link href={`/discipline/${c.id}`} className="card flex flex-wrap items-center justify-between gap-2 hover:border-brand">
              <span><span className="block font-medium">{c.title}</span><span className="text-xs text-muted">{c.number} · incident {c.incident}{c.response_due && c.status === 'issued' ? ` · respond by ${new Date(c.response_due).toLocaleString(p.org.locale, { timeZone: p.org.timezone })}` : ''}</span></span>
              <span className="flex gap-1"><span className={`badge ${TONE[c.kind] ?? ''}`}>{KIND_LABEL[c.kind]}</span><span className="badge">{c.status}</span></span></Link></li>))}</ul>)}
        <p className="text-xs text-muted">If you believe a record is unfair, you may raise it with HR in writing. Where fines are involved, they appear on your payslip with the dates they relate to.</p>
      </div>
    );
  });
}
