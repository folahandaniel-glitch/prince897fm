import Link from 'next/link';
import { page } from '@/server/session';
import { myCard, myTrend } from '@/server/kpi';
import { myFlags } from '@/server/flags';
import { myExpectations } from '@/server/deliverables';
import { PageHead, Stat, Notice } from '@/components/ui';

export const metadata = { title: 'My performance' };
export const dynamic = 'force-dynamic';

export default async function MyPerformance() {
  const period = new Date().toISOString().slice(0, 7);
  return page(async (p) => {
    const [card, trend, flags, exp] = await Promise.all([myCard(p.ctx, period, 5), myTrend(p.ctx, 6), myFlags(p.ctx), p.allowed('deliverable:submit') ? myExpectations(p.ctx, period).catch(() => []) : Promise.resolve([])]);
    const done = exp.reduce((a: number, d: any) => a + Math.min(d.approved, d.target_count), 0), target = exp.reduce((a: number, d: any) => a + d.target_count, 0);
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <PageHead title="My performance" sub={`${period}: where you stand, in one place.`}><Link href="/kpi" className="btn-ghost">Full KPI card</Link></PageHead>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="KPI score" value={card?.score != null ? `${card.score.toFixed(0)}%` : '—'} sub={card?.rating} href="/kpi" />
          <Stat label="Deliverables" value={target ? `${done}/${target}` : '—'} sub="approved this month" href="/deliverables" />
          <Stat label="Warnings" value={flags.length} sub={flags.length ? 'see below' : 'all clear'} />
        </div>
        {flags.length === 0 ? <Notice>No warning signs this month. Keep it up.</Notice> : <section className="card"><h2 className="font-semibold">Things to look at</h2><ul className="mt-2 space-y-2 text-sm">{flags.map((f) => <li key={f.code}><span className={`badge ${f.severity === 'act' ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-900'}`}>{f.label}</span> <span className="text-muted">{f.detail}</span></li>)}</ul></section>}
        <section className="card"><h2 className="font-semibold">Last six months</h2><ul className="mt-2 text-sm">{trend.length === 0 ? <li className="text-muted">No history yet.</li> : trend.map((t) => <li key={t.period} className="flex items-center gap-3 py-1"><span className="w-20 text-muted">{t.period}</span><span className="h-2 flex-1 overflow-hidden rounded-full bg-surface"><span className="block h-full bg-brand" style={{ width: `${t.score ?? 0}%` }} /></span><span className="w-12 text-right tabular-nums">{t.score != null ? `${t.score.toFixed(0)}%` : '—'}</span></li>)}</ul></section>
      </div>
    );
  });
}
