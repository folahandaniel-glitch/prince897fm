import Link from 'next/link';
import { page } from '@/server/session';
import { hubReport, type HubKind } from '@/server/reporthub';
import { UserError } from '@/server/ctx';
import { ForbiddenError } from '@/domain/policy';
import { PageHead, Notice } from '@/components/ui';

export const metadata = { title: 'Report hub' };
export const dynamic = 'force-dynamic';

const KINDS: [HubKind, string, string][] = [['attendance', 'Attendance', 'attendance:view'], ['leave', 'Leave', 'leave:review'], ['payroll', 'Payroll', 'payroll:view'], ['tasks', 'Tasks', 'task:assign']];

export default async function Hub({ searchParams }: { searchParams: Promise<{ k?: string; period?: string }> }) {
  const sp = await searchParams;
  const period = /^\d{4}-\d{2}$/.test(sp.period ?? '') ? sp.period! : new Date().toISOString().slice(0, 7);
  return page(async (p) => {
    const avail = KINDS.filter(([, , perm]) => p.allowed(perm));
    const kind = (avail.find(([k]) => k === sp.k)?.[0] ?? avail[0]?.[0]) as HubKind | undefined;
    let t = null as Awaited<ReturnType<typeof hubReport>> | null, err = '';
    if (kind) { try { t = await hubReport(p.ctx, kind, period); } catch (e) { if (e instanceof UserError || e instanceof ForbiddenError) err = e.message; else throw e; } }
    return (
      <div className="space-y-4">
        <PageHead title="Report hub" sub="Attendance, leave, payroll and task reports for the people you manage. Download any of them as a spreadsheet." />
        {!kind ? <Notice>Your role has no management reports.</Notice> : <>
          <div className="flex flex-wrap items-center gap-2">{avail.map(([k, l]) => <Link key={k} href={`?k=${k}&period=${period}`} className={`btn ${k === kind ? 'bg-brand text-white' : 'btn-ghost'}`}>{l}</Link>)}
            <form className="ml-auto flex gap-2"><input type="hidden" name="k" value={kind} /><input type="month" name="period" defaultValue={period} className="input" aria-label="Month" /><button className="btn-ghost">Show</button></form>
            <a className="btn-primary" href={`/api/reports/hub?k=${kind}&period=${period}`}>Download CSV</a></div>
          {err ? <Notice tone="warn">{err}</Notice> : t && <div className="card overflow-x-auto !p-0"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-muted"><tr>{t.head.map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{t.rows.length === 0 ? <tr><td className="p-3 text-muted" colSpan={t.head.length}>No data for this month.</td></tr> : t.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="p-3 tabular-nums">{v}</td>)}</tr>)}</tbody></table></div>}</>}
      </div>
    );
  });
}
