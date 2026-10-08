import Link from 'next/link';
import { page } from '@/server/session';
import { myCard, myTrend } from '@/server/kpi';
import { need } from '@/server/ctx';
import { Gauge, HBars, Sparkline } from '@/components/charts';
import { LEVEL_BANDS } from '@/domain/kpi';
import { Notice } from '@/components/ui';
import { fmtValue } from '@/components/kpi-format';

export const metadata = { title: 'My KPI' };
export const dynamic = 'force-dynamic';

const TONE: Record<string, string> = { good: 'bg-emerald-100 text-emerald-900', ok: 'bg-sky-100 text-sky-900', warn: 'bg-amber-100 text-amber-900', bad: 'bg-red-100 text-red-900', none: 'bg-slate-100 text-slate-700' };

export default async function MyKpi({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const sp = await searchParams;
  return page(async (p) => {
    p.requireFeature('kpi');
    need(p.ctx, 'kpi:view:own');
    const now = new Date().toISOString().slice(0, 7);
    const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.period ?? '') ? sp.period! : now;
    const [card, trend] = await Promise.all([myCard(p.ctx, period), myTrend(p.ctx)]);
    const focus = card ? [...card.lines].filter((l) => l.score != null).sort((a, b) => (a.score as number) - (b.score as number)).slice(0, 3).filter((l) => (l.score as number) < 75) : [];
    return (
      <div className="min-w-0 space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold">My KPI</h1><p className="text-sm text-muted">Your monthly performance score, built from measures that fit your department and level.</p></div>
          <form className="flex items-end gap-2" role="search"><div><label className="label" htmlFor="period">Month</label><input id="period" name="period" type="month" defaultValue={period} max={now} className="input" /></div><button className="btn-ghost">Show</button></form></header>
        {!card ? <Notice tone="warn">Your login is not linked to an employee record, so there is no KPI to show. Ask HR to link it.</Notice> : (<>
          <section className="card grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
            <Gauge value={card.score} label="KPI score" sub={card.rating} />
            <div className="min-w-0 space-y-2"><div className="flex flex-wrap items-center gap-2"><span className={`badge ${TONE[card.tone]}`}>{card.rating}</span>{card.status === 'final' && <span className="badge">Finalised</span>}</div>
              <p className="text-sm text-muted">{card.position ?? 'Staff'}{card.department ? ` · ${card.department}` : ''} · {LEVEL_BANDS.find((b) => b.key === card.band)?.label} level{card.profile ? ` · profile "${card.profile}"` : ''}</p>
              {card.coverage < 100 && card.score != null && <p className="text-xs text-muted">Only {Math.round(card.coverage)}% of the weighted measures have data so far; the score reflects those. It firms up as the month goes on.</p>}
              <div><p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Last months</p><Sparkline values={trend.map((t) => t.score)} label="KPI by month" /></div></div>
          </section>
          {focus.length > 0 && <Notice>Where you can gain most this month: {focus.map((l) => l.name).join(', ')}.</Notice>}
          <section className="card overflow-x-auto p-0"><table className="w-full min-w-[34rem]"><thead><tr className="border-b border-line"><th className="th">Measure</th><th className="th text-right">Weight</th><th className="th text-right">Result</th><th className="th text-right">Target</th><th className="th">Score</th></tr></thead>
            <tbody>{card.lines.map((l) => <tr key={l.key} className="border-b border-line last:border-0"><td className="td font-medium">{l.name}{l.source === 'manual' && <span className="ml-2 text-xs font-normal text-muted">rated by supervisor</span>}</td><td className="td text-right tabular-nums">{l.weight}%</td><td className="td text-right tabular-nums">{fmtValue(l)}</td><td className="td text-right tabular-nums text-muted">{l.target != null ? (l.source === 'sales_target' ? `₦${l.target.toLocaleString('en-NG')}` : l.target) : '–'}</td>
              <td className="td"><div className="flex items-center gap-2"><div className="h-2 w-24 overflow-hidden rounded-full bg-surface" role="img" aria-label={l.score == null ? 'no score yet' : `${Math.round(l.score)} out of 100`}><div className="h-full rounded-full" style={{ width: `${l.score ?? 0}%`, background: (l.score ?? 0) >= 75 ? '#16a34a' : (l.score ?? 0) >= 50 ? 'rgb(var(--accent))' : '#dc2626' }} /></div><span className="w-8 text-xs tabular-nums">{l.score == null ? '–' : Math.round(l.score)}</span></div></td></tr>)}</tbody></table></section>
          <section className="card"><h2 className="font-semibold">How the score is made</h2><div className="mt-3"><HBars label="Weights" data={card.lines.map((l) => ({ label: l.name, value: l.weight, sub: '%' }))} /></div>
            <p className="mt-3 text-sm text-muted">Punctuality, attendance, tasks and reports come straight from the system. The knowledge score comes from your <Link className="underline" href="/assessment">monthly assessment</Link>. Other measures are rated by your supervisor.</p></section>
        </>)}
      </div>
    );
  });
}
