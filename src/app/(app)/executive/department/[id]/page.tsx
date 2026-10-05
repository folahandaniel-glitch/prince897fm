import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page } from '@/server/session';
import { departmentDetail } from '@/server/executive';

export const dynamic = 'force-dynamic';
const tm = (d: any, tz: string) => (d ? new Date(d).toLocaleTimeString('en-NG', { timeZone: tz, hour: '2-digit', minute: '2-digit' }) : '—');

export default async function DepartmentDrill({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return page(async (p) => {
    const d = await departmentDetail(p.ctx, id);
    return (
      <div className="space-y-4">
        <nav className="text-sm text-muted" aria-label="Breadcrumb"><Link className="underline" href="/executive">Command centre</Link> / {d.dept.name}</nav>
        <h1 className="text-2xl font-bold">{d.dept.name}</h1>
        <p className="text-sm text-muted">{d.date} · access to this view is recorded in the audit trail.</p>
        <div className="card overflow-x-auto p-0"><table className="w-full"><thead><tr className="border-b border-line"><th className="th">Name</th><th className="th">Position</th><th className="th">Clock-in</th><th className="th">Latest report</th><th className="th">Overdue tasks</th></tr></thead>
          <tbody>{d.people.map((e: any) => (
            <tr key={e.id} className="border-b border-line last:border-0"><td className="td font-medium"><Link className="underline" href={`/employees/${e.id}`}>{e.full_name}</Link></td><td className="td">{e.position ?? '—'}</td>
              <td className="td">{e.clock_in_at ? `${tm(e.clock_in_at, p.org.timezone)}${e.late_minutes > 0 ? ` (${e.late_minutes}m late)` : ''}` : 'Not in'}</td><td className="td">{e.last_report ? e.last_report.replace('_', ' ') : '—'}</td><td className="td">{e.overdue_tasks}</td></tr>))}</tbody></table></div>
      </div>
    );
  });
}
