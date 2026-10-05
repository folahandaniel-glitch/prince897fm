import Link from 'next/link';
import { page, mutate, field, optional } from '@/server/session';
import { KIND_LABEL, listCases, listRules, raiseCase } from '@/server/discipline';
import { need } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';
import { Empty, PageHead } from '@/components/ui';

export const metadata = { title: 'Discipline cases' };
export const dynamic = 'force-dynamic';

async function raise(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/discipline/cases'], async (c) => {
    const r = await raiseCase(c, { employeeId: field(f, 'employeeId'), kind: field(f, 'kind'), ruleId: optional(f, 'ruleId'), title: field(f, 'title'), facts: field(f, 'facts'), incidentDate: field(f, 'incidentDate'), responseHours: Number(field(f, 'hours')) || 48, basisCaseId: optional(f, 'basis'), overrideReason: field(f, 'override'), fineAmount: field(f, 'fine'), fineMonth: field(f, 'fineMonth') });
    return `${r.number} recorded and the employee has been notified.`;
  });
}

export default async function Cases() {
  return page(async (p) => {
    p.requireFeature('discipline');
    need(p.ctx, 'discipline:raise');
    const [cases, rules, people] = await Promise.all([listCases(p.ctx, 'all'), listRules(p.ctx.q), p.ctx.q.query<any>(`select e.id, e.full_name from employees e where e.status in ('active','on_leave') and not e.hidden and (e.user_id is null or e.user_id <> $1) order by e.full_name`, [p.ctx.userId])]);
    const decide = p.allowed('discipline:decide');
    const queries = cases.filter((c: any) => c.kind === 'query');
    return (
      <div className="space-y-5">
        <PageHead title="Discipline cases" sub="Fair process first: a written query, time to respond, then a reasoned decision. Records are confidential."><Link href="/discipline/rules" className="btn-ghost">Rules &amp; guidance</Link></PageHead>
        {cases.length === 0 ? <Empty title="No cases" text="Nothing has been raised." /> : (
          <div className="card overflow-x-auto p-0"><table className="w-full min-w-[40rem]"><thead><tr className="border-b border-line"><th className="th">No.</th><th className="th">Employee</th><th className="th">Matter</th><th className="th">Type</th><th className="th">Status</th></tr></thead>
            <tbody>{cases.map((c: any) => <tr key={c.id} className="border-b border-line last:border-0"><td className="td"><Link className="font-medium underline" href={`/discipline/${c.id}`}>{c.number}</Link></td><td className="td">{c.full_name}</td><td className="td">{c.title}</td><td className="td"><span className="badge">{KIND_LABEL[c.kind]}</span></td><td className="td"><span className="badge">{c.status}</span></td></tr>)}</tbody></table></div>)}
        <section className="card" aria-labelledby="raise"><h2 id="raise" className="font-semibold">Raise a matter</h2>
          <p className="text-sm text-muted">Start with a <strong>query</strong>. Written warnings, final warnings, suspensions and fines must follow a query the employee has answered (or let lapse), unless HR records a written reason.</p>
          <ActionForm action={raise as any} submit="Record and notify" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-2">
            <Select label="Employee" name="employeeId" required allowEmpty={false} options={people.map((x: any) => ({ value: x.id, label: x.full_name }))} />
            <Select label="Issue" name="kind" required allowEmpty={false} defaultValue="query" options={Object.entries(KIND_LABEL).filter(([k]) => decide || ['query', 'verbal_warning', 'commendation'].includes(k)).map(([value, label]) => ({ value, label }))} />
            <Select label="Rule or policy concerned" name="ruleId" options={rules.map((r: any) => ({ value: r.id, label: `${r.title}` }))} />
            <Field label="Date of incident" name="incidentDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            <Field label="Title" name="title" required placeholder="e.g. Repeated lateness in October" /><Field label="Hours allowed to respond (queries)" name="hours" type="number" defaultValue="48" />
            {decide && <Select label="Based on query (for sanctions)" name="basis" options={queries.map((q: any) => ({ value: q.id, label: `${q.number} · ${q.full_name}` }))} />}
            {decide && <Field label="…or reason no query was issued" name="override" hint="Required only when a sanction is recorded without a query." />}
            {decide && <><Field label="Fine amount (₦, fines only)" name="fine" /><Field label="Pay month for the fine" name="fineMonth" type="month" /></>}</div>
            <div className="mb-1"><label className="label" htmlFor="facts">What happened (the employee will read this)</label><textarea id="facts" name="facts" rows={4} required minLength={20} className="input py-2" placeholder="State the facts: what, when, where and the effect. Avoid opinions." /></div></ActionForm></section>
      </div>
    );
  });
}
