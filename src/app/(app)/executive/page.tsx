import Link from 'next/link';
import { page } from '@/server/session';
import { overview } from '@/server/executive';
import { need } from '@/server/ctx';

export const metadata = { title: 'Command centre' };
export const dynamic = 'force-dynamic';

const LEVEL: Record<string, string> = { critical: 'border-red-600 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100', warning: 'border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100', info: 'border-line' };
const Kpi = ({ label, value, sub, href }: { label: string; value: React.ReactNode; sub?: string; href?: string }) => {
  const body = <><p className="text-xs text-muted">{label}</p><p className="mt-1 text-3xl font-bold">{value}</p>{sub && <p className="text-xs text-muted">{sub}</p>}</>;
  return href ? <Link href={href} className="card block !p-4 hover:border-brand">{body}</Link> : <div className="card !p-4">{body}</div>;
};

export default async function Executive() {
  return page(async (p) => {
    need(p.ctx, 'dashboard:executive');
    const o = await overview(p.ctx);
    const pendingTotal = o.pend.exceptions + o.pend.leave + o.pend.registrations + o.pend.reports;
    return (
      <div className="space-y-6">
        <header><h1 className="text-2xl font-bold">Command centre</h1><p className="text-sm text-muted">{p.org.name} · {o.date}</p></header>

        {o.alerts.length > 0 && <section aria-label="Alerts" className="space-y-2">{o.alerts.map((a, i) => (
          <p key={i} className={`rounded-lg border-l-4 px-4 py-2 text-sm ${LEVEL[a.level]}`}>{a.href ? <Link href={a.href} className="underline">{a.text}</Link> : a.text}</p>))}</section>}

        <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Staff" value={o.people.active} sub={`${o.people.on_leave} on leave · ${o.people.total} on record`} href="/employees" />
          <Kpi label="Clocked in today" value={o.att.present} sub={`${o.att.late} late · ${o.rostered.absent} rostered but absent`} href="/attendance/team" />
          <Kpi label="Waiting for approval" value={pendingTotal} sub={`${o.pend.reports} reports · ${o.pend.leave} leave · ${o.pend.exceptions} attendance`} />
          <Kpi label="Tasks overdue" value={o.tasks.overdue} sub={`${o.tasks.open} open · ${o.tasks.blocked} blocked`} href="/tasks?scope=team&status=open" />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="card" aria-labelledby="comp"><h2 id="comp" className="font-semibold">Reporting compliance</h2>
            {o.comp.length === 0 ? <p className="mt-2 text-sm text-muted">No report templates are active.</p> : <ul className="mt-3 space-y-3">{o.comp.map((k) => {
              const pct = k.expected ? Math.round((k.submitted / k.expected) * 100) : 0;
              return <li key={k.template}><div className="flex justify-between text-sm"><span>{k.template}</span><span className="font-semibold">{pct}%</span></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface" role="img" aria-label={`${k.template}: ${pct}% submitted`}><div className="h-full bg-brand-2" style={{ width: `${pct}%` }} /></div>
                <p className="mt-1 text-xs text-muted">{k.submitted}/{k.expected} submitted · {k.missing.length} outstanding</p></li>;
            })}</ul>}
            <Link className="mt-3 inline-block text-sm underline" href="/reports/oversight">Open compliance detail</Link></div>

          <div className="card" aria-labelledby="dept"><h2 id="dept" className="font-semibold">By department</h2>
            <div className="mt-2 overflow-x-auto"><table className="w-full"><thead><tr className="border-b border-line"><th className="th">Department</th><th className="th">Staff</th><th className="th">In today</th><th className="th">Overdue tasks</th></tr></thead>
              <tbody>{o.byDept.map((d: any) => <tr key={d.id} className="border-b border-line last:border-0"><td className="td"><Link className="font-medium underline" href={`/executive/department/${d.id}`}>{d.name}</Link></td><td className="td">{d.headcount}</td><td className="td">{d.present}</td><td className="td">{d.overdue_tasks}</td></tr>)}</tbody></table></div></div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="card" aria-labelledby="sens"><h2 id="sens" className="font-semibold">Sensitive changes, last 7 days</h2>
            {o.sens.length === 0 ? <p className="mt-2 text-sm text-muted">None recorded.</p> : <ul className="mt-2 divide-y divide-line text-sm">{o.sens.map((s: any) => <li key={s.action} className="flex justify-between py-1.5"><span>{s.action.replace(/[._]/g, ' ')}</span><span className="font-semibold">{s.n}</span></li>)}</ul>}</div>
          <div className="card" aria-labelledby="feed"><h2 id="feed" className="font-semibold">Recent activity</h2>
            <ul className="mt-2 divide-y divide-line text-sm">{o.feed.map((f: any) => <li key={f.id} className="py-1.5"><span className="font-mono text-xs">{f.action}</span> <span className="text-muted">· {f.actor ?? 'system'} · {new Date(f.created_at).toLocaleTimeString(p.org.locale, { timeZone: p.org.timezone, hour: '2-digit', minute: '2-digit' })}</span></li>)}</ul>
            {p.allowed('audit:view') && <Link className="mt-2 inline-block text-sm underline" href="/admin/audit">Full audit trail</Link>}</div>
        </section>
      </div>
    );
  });
}
