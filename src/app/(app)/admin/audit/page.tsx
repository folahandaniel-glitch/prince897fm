import { page } from '@/server/session';
import { listAudit } from '@/server/hr';
import { verifyAuditChain } from '@/server/audit';
import { need } from '@/server/ctx';

export const metadata = { title: 'Audit trail' };
export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  return page(async (p) => {
    need(p.ctx, 'audit:view');
    const rows = await listAudit(p.ctx, 100);
    const broken = await verifyAuditChain(p.ctx.q, p.ctx.orgId);
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Audit trail</h1>
        <p role="status" className={`card text-sm ${broken ? 'border-red-600' : ''}`}>
          {broken ? `Integrity check FAILED: the record chain breaks at event ${broken}. Escalate to your security contact.` : 'Integrity check passed: every event is chained to the one before it.'}
        </p>
        <div className="card overflow-x-auto p-0"><table className="w-full"><thead><tr className="border-b border-line"><th className="th">#</th><th className="th">When</th><th className="th">Who</th><th className="th">Action</th><th className="th">Record</th><th className="th">Reason</th></tr></thead>
          <tbody>{rows.map((r: any) => (
            <tr key={r.id} className="border-b border-line last:border-0"><td className="td">{r.id}</td>
              <td className="td whitespace-nowrap">{new Date(r.created_at).toLocaleString(p.org.locale, { timeZone: p.org.timezone })}</td>
              <td className="td">{r.actor ?? 'system / public'}</td><td className="td font-mono text-xs">{r.action}</td><td className="td">{r.entity}</td><td className="td">{r.reason ?? ''}</td></tr>))}</tbody></table></div>
      </div>
    );
  });
}
