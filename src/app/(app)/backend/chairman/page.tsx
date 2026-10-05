import Link from 'next/link';
import { page } from '@/server/session';
import { chairmanQueue } from '@/server/backend';
import { Money } from '@/components/money';
import { Empty, Notice, Stat } from '@/components/ui';

export const metadata = { title: 'Assist the Chairman · BackEnd' };
export const dynamic = 'force-dynamic';

export default async function Assist() {
  return page(async (p) => {
    const q = await chairmanQueue(p.ctx);
    const k = { cur: p.org.currency, loc: p.org.locale };
    const total = q.fin.length + q.rep.length + q.pay.length + q.disc.length;
    return (
      <div className="space-y-5">
        <Notice>You hold the Chairman&apos;s approval authority in addition to Super Administrator. Anything you decide is recorded in the audit trail as an administrator action. Segregation of duties still applies: you cannot approve what you created, reviewed or will pay.</Notice>
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Waiting on the Chairman" value={total} /><Stat label="Payments" value={q.fin.length} href="/finance" /><Stat label="Reports" value={q.rep.length} href="/reports/review" /><Stat label="Payroll runs" value={q.pay.length} href="/payroll" /></section>
        {total === 0 ? <Empty title="Nothing is waiting" text="The Chairman's approval queues are clear." /> : (
          <div className="grid gap-4 lg:grid-cols-2">
            {q.fin.length > 0 && <section className="card"><h2 className="font-semibold">Payments awaiting the Chairman</h2><ul className="mt-2 divide-y divide-line text-sm">{q.fin.map((t: any) => <li key={t.id}><Link className="flex justify-between py-2 hover:underline" href={`/finance/${t.id}`}><span>{t.number} {t.title}</span><Money v={Math.round(Number(t.amount) * 100)} {...k} /></Link></li>)}</ul></section>}
            {q.rep.length > 0 && <section className="card"><h2 className="font-semibold">Reports at the executive stage</h2><ul className="mt-2 text-sm">{q.rep.map((r: any) => <li key={r.id} className="py-1">{r.name} · {r.full_name}</li>)}</ul><Link className="mt-2 inline-block text-sm underline" href="/reports/review">Open reviews</Link></section>}
            {q.pay.length > 0 && <section className="card"><h2 className="font-semibold">Payroll awaiting approval</h2><ul className="mt-2 text-sm">{q.pay.map((r: any) => <li key={r.id}><Link className="underline" href={`/payroll/runs/${r.id}`}>Payroll {r.period}</Link></li>)}</ul></section>}
            {q.disc.length > 0 && <section className="card"><h2 className="font-semibold">Queries awaiting a decision</h2><ul className="mt-2 text-sm">{q.disc.map((r: any) => <li key={r.id}><Link className="underline" href={`/discipline/${r.id}`}>{r.number} · {r.title}</Link></li>)}</ul></section>}
          </div>)}
        <p className="text-sm text-muted">The Chairman has {q.unreadForChairman} unread notification(s). For privacy, their content is not shown here.</p>
      </div>
    );
  });
}
