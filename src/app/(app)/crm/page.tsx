import Link from 'next/link';
import { page, mutate, field } from '@/server/session';
import { createAccount, followUpsDue, listAccounts, moveOpportunity, pipeline, completeFollowUp, STAGE_LABEL } from '@/server/crm';
import { need } from '@/server/ctx';
import { Money } from '@/components/money';
import { ActionForm, Field, Select } from '@/components/forms';
import { Empty, PageHead, Stat } from '@/components/ui';

export const metadata = { title: 'CRM' };
export const dynamic = 'force-dynamic';

async function add(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/crm'], async (c) => { await createAccount(c, { name: field(f, 'name'), kind: field(f, 'kind'), status: field(f, 'status'), industry: field(f, 'industry'), phone: field(f, 'phone'), email: field(f, 'email'), source: field(f, 'source'), contactName: field(f, 'contact'), contactPhone: field(f, 'cphone') }); return 'Account created.'; });
}
async function move(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/crm'], async (c) => moveOpportunity(c, field(f, 'id'), field(f, 'stage'), field(f, 'reason')));
}
async function done(_p: unknown, f: FormData) { 'use server'; return mutate(['/crm'], async (c) => { await completeFollowUp(c, field(f, 'id')); return 'Marked done.'; }); }

const TONE: Record<string, string> = { lead: 'bg-sky-100 text-sky-900', prospect: 'bg-amber-100 text-amber-900', client: 'bg-emerald-100 text-emerald-900', inactive: '' };

export default async function CrmHome({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const sp = await searchParams;
  return page(async (p) => {
    p.requireFeature('crm');
    need(p.ctx, 'crm:view');
    const [pipe, accounts, due] = await Promise.all([pipeline(p.ctx), listAccounts(p.ctx, { status: sp.status, q: sp.q }), followUpsDue(p.ctx, 0)]);
    const k = { cur: p.org.currency, loc: p.org.locale };
    const manage = p.allowed('crm:manage');
    return (
      <div className="space-y-6">
        <PageHead title="CRM" sub="Advertisers, sponsors and clients: who they are, what you have discussed and what is next." />
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Open pipeline" value={<Money v={pipe.openValue} {...k} />} /><Stat label="Win rate (30 days)" value={pipe.winRate === null ? '-' : `${pipe.winRate}%`} /><Stat label="Follow-ups due" value={due.length} /><Stat label="Accounts" value={accounts.length} /></section>

        {due.length > 0 && <section className="card" aria-labelledby="fu"><h2 id="fu" className="font-semibold">Follow-ups due</h2><ul className="mt-2 divide-y divide-line text-sm">{due.map((d: any) => <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><Link className="font-medium underline" href={`/crm/${d.account_id}`}>{d.account}</Link> · {d.summary} <span className="text-muted">({d.due})</span></span>{manage && <ActionForm action={done as any} submit="Done" tone="ghost" className="!mt-0"><input type="hidden" name="id" value={d.id} /><span /></ActionForm>}</li>)}</ul></section>}

        <section aria-label="Pipeline" className="-mx-3 overflow-x-auto px-3 pb-2 sm:mx-0 sm:px-0">
          <div className="grid min-w-[60rem] grid-cols-6 gap-3">{pipe.cols.map((col) => (
            <div key={col.stage} className="rounded-2xl bg-surface p-2"><div className="mb-2 flex items-baseline justify-between px-1"><h3 className="text-sm font-semibold">{col.label}</h3><span className="text-xs text-muted">{col.items.length}</span></div>
              <ul className="space-y-2">{col.items.map((o: any) => (
                <li key={o.id} className="card !p-3 text-sm"><Link href={`/crm/${o.account_id}`} className="font-medium underline">{o.account}</Link><p className="text-xs text-muted">{o.title}</p><p className="mt-1 font-semibold"><Money v={o.valueMinor} {...k} /></p>
                  {manage && !['won', 'lost'].includes(col.stage) && <ActionForm action={move as any} submit="Move" tone="ghost" className="mt-2" buttons={[{ label: 'Next stage →', value: 'next', tone: 'ghost' }]}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="stage" value={['new', 'contacted', 'proposal', 'negotiation', 'won'][['new', 'contacted', 'proposal', 'negotiation'].indexOf(col.stage) + 1]} /></ActionForm>}</li>))}</ul>
              {col.items.length === 0 && <p className="px-1 py-3 text-xs text-muted">Empty</p>}
              <p className="mt-2 px-1 text-xs font-medium"><Money v={col.total} {...k} /></p></div>))}</div>
        </section>

        <section className="card" aria-labelledby="acc"><div className="flex flex-wrap items-center justify-between gap-2"><h2 id="acc" className="font-semibold">Accounts</h2>
          <form className="flex gap-2" role="search"><label className="sr-only" htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q} className="input" placeholder="Search accounts" /><select name="status" defaultValue={sp.status ?? ''} className="input w-auto" aria-label="Status"><option value="">All</option><option value="lead">Leads</option><option value="prospect">Prospects</option><option value="client">Clients</option><option value="inactive">Inactive</option></select><button className="btn-ghost">Filter</button></form></div>
          {accounts.length === 0 ? <div className="mt-3"><Empty title="No accounts yet" text="Add your first advertiser or sponsor." /></div> : <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[34rem]"><thead><tr className="border-b border-line"><th className="th">Name</th><th className="th">Status</th><th className="th">Owner</th><th className="th text-right">Open value</th><th className="th">Next follow-up</th></tr></thead>
            <tbody>{accounts.map((a: any) => <tr key={a.id} className="border-b border-line last:border-0"><td className="td font-medium"><Link className="underline" href={`/crm/${a.id}`}>{a.name}</Link></td><td className="td"><span className={`badge ${TONE[a.status]}`}>{a.status}</span></td><td className="td">{a.owner ?? '-'}</td><td className="td text-right"><Money v={Math.round(Number(a.open_value) * 100)} {...k} /></td><td className="td">{a.next_follow_up ?? '-'}</td></tr>)}</tbody></table></div>}</section>

        {manage && <section className="card" aria-labelledby="new"><h2 id="new" className="font-semibold">Add an account</h2>
          <ActionForm action={add as any} submit="Add account" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-3"><Field label="Name" name="name" required /><Select label="Type" name="kind" allowEmpty={false} defaultValue="company" options={[{ value: 'company', label: 'Company' }, { value: 'individual', label: 'Individual' }]} /><Select label="Stage" name="status" allowEmpty={false} defaultValue="lead" options={Object.entries({ lead: 'Lead', prospect: 'Prospect', client: 'Client' }).map(([value, label]) => ({ value, label }))} />
            <Field label="Industry" name="industry" /><Field label="Phone" name="phone" type="tel" /><Field label="Email" name="email" type="email" /><Field label="How did they find us?" name="source" /><Field label="Contact person" name="contact" /><Field label="Contact phone" name="cphone" type="tel" /></div></ActionForm></section>}
        <p className="hidden">{STAGE_LABEL.new}</p>
      </div>
    );
  });
}
