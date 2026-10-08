import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page, mutate, field } from '@/server/session';
import { cardFor, finalise, rate } from '@/server/kpi';
import { ActionForm, Field } from '@/components/forms';
import { Gauge } from '@/components/charts';
import { fmtValue } from '@/components/kpi-format';
import { LEVEL_BANDS } from '@/domain/kpi';

export const metadata = { title: 'KPI scorecard' };
export const dynamic = 'force-dynamic';

export default async function Person({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ period?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const now = new Date().toISOString().slice(0, 7);
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.period ?? '') ? sp.period! : now;
  const paths = [`/kpi/${id}`, '/kpi/team', '/kpi'];
  async function ratePerson(_p: unknown, f: FormData) { 'use server'; return mutate(paths, async (c) => { await rate(c, id, field(f, 'metric'), field(f, 'period'), Number(field(f, 'value')), field(f, 'note')); return 'Rating saved.'; }); }
  async function lock(_p: unknown, f: FormData) { 'use server'; return mutate(paths, async (c) => { const reopen = field(f, 'intent') === 'reopen'; await finalise(c, id, field(f, 'period'), reopen); return reopen ? 'Reopened.' : 'Finalised. This month can no longer change.'; }); }
  return page(async (p) => {
    p.requireFeature('kpi');
    const card = await cardFor(p.ctx, id, period);
    if (!card) notFound();
    const canRate = p.allowed('kpi:rate') && p.ctx.subject.employeeId !== id && card.status !== 'final';
    return (
      <div className="min-w-0 space-y-5">
        <nav className="text-sm text-muted" aria-label="Breadcrumb"><Link className="underline" href="/kpi/team">Team KPIs</Link> / {card.name}</nav>
        <header className="card grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center"><Gauge value={card.score} label={`${card.name} KPI`} sub={card.rating} />
          <div><h1 className="text-2xl font-bold">{card.name}</h1><p className="text-sm text-muted">{card.position ?? 'Staff'}{card.department ? ` · ${card.department}` : ''} · {LEVEL_BANDS.find((b) => b.key === card.band)?.label} · {period}{card.profile ? ` · ${card.profile}` : ''}</p>
            <form className="mt-2 flex items-end gap-2"><div><label className="label" htmlFor="period">Month</label><input id="period" name="period" type="month" defaultValue={period} max={now} className="input" /></div><button className="btn-ghost">Show</button></form></div></header>
        <section className="card overflow-x-auto p-0"><table className="w-full min-w-[34rem]"><thead><tr className="border-b border-line"><th className="th">Measure</th><th className="th text-right">Weight</th><th className="th text-right">Result</th><th className="th text-right">Score</th></tr></thead>
          <tbody>{card.lines.map((l) => <tr key={l.key} className="border-b border-line last:border-0"><td className="td font-medium">{l.name}{l.source === 'manual' && <span className="ml-2 text-xs font-normal text-muted">rated</span>}</td><td className="td text-right tabular-nums">{l.weight}%</td><td className="td text-right">{fmtValue(l)}</td><td className="td text-right tabular-nums font-semibold">{l.score == null ? '–' : Math.round(l.score)}</td></tr>)}</tbody></table></section>
        {canRate && card.lines.some((l) => l.source === 'manual') && (
          <section className="card"><h2 className="font-semibold">Rate {card.name.split(' ')[0]}</h2><p className="mt-1 text-sm text-muted">Give a score from 0 to 100 for each measure that is rated by the supervisor. Each rating is recorded with your name. You cannot rate yourself.</p>
            <div className="mt-3 space-y-4">{card.lines.filter((l) => l.source === 'manual').map((l) => (
              <ActionForm key={l.key} action={ratePerson as any} submit={`Save ${l.name}`} tone="ghost" className="!mt-0 rounded-xl border border-line p-3"><input type="hidden" name="metric" value={l.key} /><input type="hidden" name="period" value={period} />
                <p className="text-sm font-medium">{l.name} <span className="font-normal text-muted">({l.weight}%)</span></p>
                <div className="grid gap-x-3 sm:grid-cols-[8rem_1fr]"><Field label="Score (0-100)" name="value" type="number" required defaultValue={l.value != null ? String(Math.round(l.value)) : ''} /><Field label="Comment (optional)" name="note" /></div></ActionForm>))}</div></section>)}
        {p.allowed('kpi:manage') && <section className="card"><h2 className="font-semibold">{card.status === 'final' ? 'This month is finalised' : 'Finalise this month'}</h2><p className="mt-1 text-sm text-muted">{card.status === 'final' ? 'The result is locked. Reopen it only to correct a mistake.' : 'Locks the result once the month has ended, for appraisal records.'}</p>
          <ActionForm action={lock as any} submit="" tone="ghost" className="mt-2" buttons={[card.status === 'final' ? { label: 'Reopen', value: 'reopen', tone: 'danger' as const } : { label: 'Finalise', value: 'final' }]}><input type="hidden" name="period" value={period} /></ActionForm></section>}
      </div>
    );
  });
}
