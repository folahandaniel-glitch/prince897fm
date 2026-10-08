import Link from 'next/link';
import { page } from '@/server/session';
import { teamFlags, THRESHOLDS } from '@/server/flags';
import { need } from '@/server/ctx';
import { PageHead, Empty, Notice } from '@/components/ui';

export const metadata = { title: 'Performance flags' };
export const dynamic = 'force-dynamic';

export default async function Flags() {
  return page(async (p) => {
    need(p.ctx, 'kpi:view');
    const rows = await teamFlags(p.ctx);
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHead title="Performance flags" sub="Early warning signs for the people you look after." />
        <Notice>Flags are prompts for a conversation, not verdicts. Rules: {THRESHOLDS.lates}+ late arrivals in 30 days, any missed clock-out, {THRESHOLDS.overdue}+ overdue tasks, KPI under {THRESHOLDS.kpiLow}%, or a weak knowledge assessment.</Notice>
        {rows.length === 0 ? <Empty title="No flags" text="Nobody in your scope is showing a warning sign right now." /> : rows.map((r) => (
          <section key={r.employeeId} className="card !p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{r.name}</p><p className="text-xs text-muted">{r.department ?? '—'}</p></div><Link className="btn-ghost" href={`/kpi/team?person=${r.employeeId}`}>KPI</Link></div>
            <ul className="mt-2 space-y-1 text-sm">{r.flags.map((f) => <li key={f.code}><span className={`badge ${f.severity === 'act' ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-900'}`}>{f.label}</span> <span className="text-muted">{f.detail}</span></li>)}</ul></section>))}
      </div>
    );
  });
}
