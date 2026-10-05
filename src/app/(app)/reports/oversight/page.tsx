import { page } from '@/server/session';
import { compliance } from '@/server/reports';
import { need } from '@/server/ctx';

export const metadata = { title: 'Report compliance' };
export const dynamic = 'force-dynamic';

export default async function Oversight() {
  return page(async (p) => {
    need(p.ctx, 'report:oversee');
    const k = await compliance(p.ctx);
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-bold">Report compliance</h1>
        {k.length === 0 ? <div className="card text-sm text-muted">No active report templates.</div> : k.map((t) => {
          const pct = t.expected ? Math.round((t.submitted / t.expected) * 100) : 0;
          return (
            <section key={t.template} className="card" aria-label={t.template}>
              <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-semibold">{t.template} <span className="font-normal text-muted">· {t.period}</span></h2>
                <span className="text-sm text-muted">Due {new Date(t.due).toLocaleString(p.org.locale, { timeZone: p.org.timezone })}</span></div>
              <div className="mt-3 flex items-center gap-4"><p className="text-3xl font-bold">{pct}%</p><p className="text-sm text-muted">{t.submitted} of {t.expected} submitted · {t.onTime} on time</p></div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface" role="img" aria-label={`${pct}% submitted`}><div className="h-full bg-brand-2" style={{ width: `${pct}%` }} /></div>
              {t.missing.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">{t.missing.length} not yet submitted{t.missing.some((m: any) => m.overdue) ? ' (overdue)' : ''}</summary>
                <ul className="mt-2 divide-y divide-line text-sm">{t.missing.map((m: any) => <li key={m.id} className="flex justify-between py-1.5"><span>{m.name}</span><span className="text-muted">{m.department ?? '—'}</span></li>)}</ul></details>}
            </section>);
        })}
      </div>
    );
  });
}
