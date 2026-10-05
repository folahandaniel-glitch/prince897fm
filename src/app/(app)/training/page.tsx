import Link from 'next/link';
import { page } from '@/server/session';
import { myTraining } from '@/server/training';
import { need } from '@/server/ctx';
import { Empty } from '@/components/ui';

export const metadata = { title: 'My training' };
export const dynamic = 'force-dynamic';

const TONE: Record<string, string> = { assigned: 'bg-sky-100 text-sky-900', completed: 'bg-emerald-100 text-emerald-900', failed: 'bg-red-100 text-red-900', overdue: 'bg-red-100 text-red-900', expired: 'bg-red-100 text-red-900', expiring: 'bg-amber-100 text-amber-900' };
const LABEL: Record<string, string> = { assigned: 'To do', completed: 'Completed', failed: 'Not passed', overdue: 'Overdue', expired: 'Expired', expiring: 'Expiring soon' };

export default async function MyTraining() {
  return page(async (p) => {
    p.requireFeature('training');
    need(p.ctx, 'training:view:own');
    const rows = await myTraining(p.ctx);
    return (
      <div className="space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">My training &amp; certificates</h1>{p.allowed('training:manage') && <Link href="/training/manage" className="btn-ghost">Manage training</Link>}</header>
        {rows.length === 0 ? <Empty title="No training yet" text="Courses assigned to you and your certificates will appear here." /> : (
          <div className="grid gap-3 md:grid-cols-2">{rows.map((r: any) => (
            <article key={r.id} className="card"><div className="flex items-start justify-between gap-2"><h2 className="font-semibold">{r.course}{r.mandatory && <span className="badge ml-2">Mandatory</span>}</h2><span className={`badge ${TONE[r.state] ?? ''}`}>{LABEL[r.state] ?? r.state}</span></div>
              <dl className="mt-2 grid grid-cols-2 gap-1 text-sm text-muted">{r.due_on && <><dt>Due</dt><dd>{r.due_on}</dd></>}{r.completed_on && <><dt>Completed</dt><dd>{r.completed_on}</dd></>}{r.expires_on && <><dt>Valid until</dt><dd>{r.expires_on}</dd></>}{r.score != null && <><dt>Score</dt><dd>{Number(r.score)}%</dd></>}{r.certificate_ref && <><dt>Certificate</dt><dd>{r.certificate_ref}</dd></>}</dl></article>))}</div>)}
      </div>
    );
  });
}
