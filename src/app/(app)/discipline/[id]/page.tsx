import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page, mutate, field } from '@/server/session';
import { acknowledge, decideQuery, getCase, KIND_LABEL, respond } from '@/server/discipline';
import { ActionForm, Field, Select } from '@/components/forms';
import { Notice, PageHead } from '@/components/ui';

export const dynamic = 'force-dynamic';
const paths = (id: string) => [`/discipline/${id}`, '/discipline', '/discipline/cases'];
async function reply(_p: unknown, f: FormData) { 'use server'; const id = field(f, 'id'); return mutate(paths(id), async (c) => { await respond(c, id, field(f, 'text')); return 'Your response was sent. A decision will not be made without considering it.'; }); }
async function ack(_p: unknown, f: FormData) { 'use server'; const id = field(f, 'id'); return mutate(paths(id), async (c) => { await acknowledge(c, id); return 'Receipt acknowledged. This does not mean you agree.'; }); }
async function decide(_p: unknown, f: FormData) { 'use server'; const id = field(f, 'id'); return mutate(paths(id), async (c) => { await decideQuery(c, id, { outcome: field(f, 'outcome'), note: field(f, 'note') }); return 'Decision recorded and the employee notified.'; }); }

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return page(async (p) => {
    p.requireFeature('discipline');
    const d = await getCase(p.ctx, id);
    if (!d) notFound();
    const { c, own, activeWarnings, related, canDecide } = d;
    const fmt = (x: any) => new Date(x).toLocaleString(p.org.locale, { timeZone: p.org.timezone });
    const overdue = c.response_due && new Date(c.response_due) < new Date();
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <nav className="text-sm text-muted" aria-label="Breadcrumb"><Link className="underline" href={own ? '/discipline' : '/discipline/cases'}>Back</Link> / {c.number}</nav>
        <PageHead title={c.title} sub={`${KIND_LABEL[c.kind]} · ${c.full_name} · ${c.department ?? ''}`}><span className="badge text-sm">{c.status}</span></PageHead>
        <section className="card"><dl className="grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-muted">Incident date</dt><dd className="font-medium">{c.incident}</dd></div><div><dt className="text-muted">Raised by</dt><dd className="font-medium">{c.issuer}</dd></div><div><dt className="text-muted">Rule / policy</dt><dd className="font-medium">{c.rule_title ?? '-'}</dd></div></dl>
          <h2 className="mt-4 text-sm font-semibold">What happened</h2><p className="mt-1 whitespace-pre-wrap text-sm">{c.facts}</p>
          {c.rule_reference && <p className="mt-3 rounded-lg bg-surface p-3 text-xs text-muted"><strong>Reference:</strong> {c.rule_reference}</p>}
          {c.fine_amount && <p className="mt-3 text-sm"><strong>Fine:</strong> ₦{Number(c.fine_amount).toLocaleString(p.org.locale, { minimumFractionDigits: 2 })} (pay month {c.fine_period}). It will appear on your payslip with the details.</p>}
          {c.warning_expires_on && <p className="mt-2 text-xs text-muted">This warning remains active until {String(c.warning_expires_on).slice(0, 10)}.</p>}</section>

        {c.kind === 'query' && c.response_due && c.status === 'issued' && <Notice tone={overdue ? 'bad' : 'warn'}>{overdue ? 'The time allowed to respond has passed.' : `Please respond by ${fmt(c.response_due)}.`}</Notice>}
        {c.employee_response && <section className="card"><h2 className="font-semibold">Employee&apos;s response</h2><p className="mt-1 whitespace-pre-wrap text-sm">{c.employee_response}</p><p className="text-xs text-muted">{c.responded_at ? fmt(c.responded_at) : ''}</p></section>}
        {own && c.kind === 'query' && c.status === 'issued' && <section className="card"><h2 className="font-semibold">Your response</h2><p className="text-sm text-muted">Explain your side. Include anything that was approved or happened that day. You may add evidence by telling HR.</p><ActionForm action={reply as any} submit="Send response" className="mt-2"><input type="hidden" name="id" value={id} /><div><label className="label" htmlFor="text">Response</label><textarea id="text" name="text" rows={5} required minLength={5} className="input py-2" /></div></ActionForm></section>}
        {own && c.kind !== 'query' && c.kind !== 'commendation' && !c.acknowledged_at && <section className="card"><h2 className="font-semibold">Acknowledge receipt</h2><p className="text-sm text-muted">Acknowledging means you have received and read this record. It does not mean you agree with it.</p><ActionForm action={ack as any} submit="I have received this" className="mt-2"><input type="hidden" name="id" value={id} /></ActionForm></section>}
        {c.decision_note && <section className="card"><h2 className="font-semibold">Decision</h2><p className="mt-1 text-sm"><strong>{c.outcome ? KIND_LABEL[c.outcome] ?? c.outcome.replace('_', ' ') : ''}</strong></p><p className="mt-1 whitespace-pre-wrap text-sm">{c.decision_note}</p><p className="text-xs text-muted">{c.decider} · {c.decided_at ? fmt(c.decided_at) : ''}</p></section>}
        {canDecide && c.kind === 'query' && c.status !== 'decided' && (
          <section className="card"><h2 className="font-semibold">Make a decision</h2>
            {c.rule_guidance && <p className="mt-1 rounded-lg bg-surface p-3 text-sm text-muted"><strong>Guidance:</strong> {c.rule_guidance}</p>}
            {activeWarnings.length > 0 && <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">Active warnings on file: {activeWarnings.map((w: any) => `${KIND_LABEL[w.kind]} (${w.number}, until ${w.expires})`).join('; ')}. Consider escalation only after weighing the response.</p>}
            <ActionForm action={decide as any} submit="Record decision" className="mt-3"><input type="hidden" name="id" value={id} />
              <Select label="Outcome" name="outcome" required allowEmpty={false} options={[{ value: 'no_action', label: 'No action' }, { value: 'verbal_warning', label: 'Verbal warning' }, { value: 'written_warning', label: 'Written warning' }, { value: 'final_warning', label: 'Final written warning' }]} />
              <div><label className="label" htmlFor="note">Reasons (how the response was considered)</label><textarea id="note" name="note" rows={4} required minLength={20} className="input py-2" /></div></ActionForm></section>)}
        {related.length > 0 && <section className="card"><h2 className="font-semibold">Related records</h2><ul className="mt-2 text-sm">{related.filter((r: any) => r.id !== id).map((r: any) => <li key={r.id}><Link className="underline" href={`/discipline/${r.id}`}>{r.number} · {KIND_LABEL[r.kind]}</Link></li>)}</ul></section>}
        {!own && activeWarnings.length > 0 && <p className="text-xs text-muted">Active warnings for this employee: {activeWarnings.length}.</p>}
        <p className="hidden"><Field label="" name="x" /></p>
      </div>
    );
  });
}
