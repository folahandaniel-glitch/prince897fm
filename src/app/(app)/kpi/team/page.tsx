import Link from 'next/link';
import { page } from '@/server/session';
import { teamCards } from '@/server/kpi';
import { need } from '@/server/ctx';
import { Empty } from '@/components/ui';

export const metadata = { title: 'Team KPIs' };
export const dynamic = 'force-dynamic';

const TONE: Record<string, string> = { good: 'bg-emerald-100 text-emerald-900', ok: 'bg-sky-100 text-sky-900', warn: 'bg-amber-100 text-amber-900', bad: 'bg-red-100 text-red-900', none: 'bg-slate-100 text-slate-700' };

export default async function Team({ searchParams }: { searchParams: Promise<{ period?: string; dept?: string }> }) {
  const sp = await searchParams;
  return page(async (p) => {
    p.requireFeature('kpi');
    need(p.ctx, 'kpi:view');
    const now = new Date().toISOString().slice(0, 7);
    const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.period ?? '') ? sp.period! : now;
    const all = await teamCards(p.ctx, period);
    const depts = [...new Set(all.map((c) => c.department ?? 'No department'))].sort();
    const cards = sp.dept ? all.filter((c) => (c.department ?? 'No department') === sp.dept) : all;
    const scored = cards.filter((c) => c.score != null);
    const avg = scored.length ? Math.round(scored.reduce((a, c) => a + (c.score as number), 0) / scored.length) : null;
    return (
      <div className="min-w-0 space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold">Team KPIs</h1><p className="text-sm text-muted">Everyone you are allowed to see, for one month.{avg != null && <> Average score <strong>{avg}</strong> across {scored.length} people.</>}</p></div>
          <form className="flex flex-wrap items-end gap-2" role="search"><div><label className="label" htmlFor="period">Month</label><input id="period" name="period" type="month" defaultValue={period} max={now} className="input" /></div>
            <div><label className="label" htmlFor="dept">Department</label><select id="dept" name="dept" defaultValue={sp.dept ?? ''} className="input"><option value="">All</option>{depts.map((d) => <option key={d}>{d}</option>)}</select></div><button className="btn-ghost">Show</button>
            {p.allowed('kpi:manage') && <Link className="btn-ghost" href="/kpi/profiles">Profiles &amp; weights</Link>}<a className="btn-ghost" href={`/api/kpi/export?period=${period}`} download>Download CSV</a></form></header>
        {cards.length === 0 ? <Empty title="Nobody to show" text="There are no staff in your scope for this filter." /> : (
          <div className="card overflow-x-auto p-0"><table className="w-full min-w-[40rem]"><thead><tr className="border-b border-line"><th className="th">Name</th><th className="th">Department</th><th className="th">Position</th><th className="th text-right">Score</th><th className="th">Rating</th><th className="th" /></tr></thead>
            <tbody>{cards.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).map((c) => <tr key={c.employeeId} className="border-b border-line last:border-0"><td className="td font-medium">{c.name}</td><td className="td">{c.department ?? '–'}</td><td className="td">{c.position ?? '–'}</td><td className="td text-right tabular-nums font-semibold">{c.score == null ? '–' : Math.round(c.score)}</td><td className="td"><span className={`badge ${TONE[c.tone]}`}>{c.rating}</span>{c.status === 'final' && <span className="badge ml-1">Final</span>}</td><td className="td text-right"><Link className="underline" href={`/kpi/${c.employeeId}?period=${period}`}>Open</Link></td></tr>)}</tbody></table></div>)}
      </div>
    );
  });
}
