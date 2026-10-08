import Link from 'next/link';
import { page, mutate, field, optional } from '@/server/session';
import { createContract, ensureStarterTemplates, listContracts, listTemplates } from '@/server/contracts';
import { listAccounts } from '@/server/crm';
import { formatMoney } from '@/domain/finance';
import { ActionForm, Field, Select } from '@/components/forms';
import { PageHead, Empty } from '@/components/ui';

export const metadata = { title: 'Contracts' };
export const dynamic = 'force-dynamic';

async function create(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/contracts'], async (c) => { const r = await createContract(c, { accountId: field(f, 'accountId'), templateId: optional(f, 'templateId') ?? undefined, title: field(f, 'title'), value: field(f, 'value'), startsOn: field(f, 'startsOn'), endsOn: field(f, 'endsOn') }); return `Created ${r.number}.`; });
}
async function starter(_p: unknown, _f: FormData) { 'use server'; return mutate(['/contracts'], async (c) => { await ensureStarterTemplates(c); return 'Starter templates added.'; }); }
const TONE: Record<string, string> = { signed: 'bg-emerald-100 text-emerald-900', sent: 'bg-sky-100 text-sky-900', expired: 'bg-red-100 text-red-900', cancelled: '', draft: 'bg-amber-100 text-amber-900' };

export default async function Contracts() {
  return page(async (p) => {
    p.requireFeature('crm');
    const manage = p.allowed('contract:manage');
    const [rows, tpls, accounts] = await Promise.all([listContracts(p.ctx), listTemplates(p.ctx), manage ? listAccounts(p.ctx) : Promise.resolve([])]);
    return (
      <div className="mx-auto max-w-4xl space-y-5">
        <PageHead title="Contracts" sub="Agreements with clients, from draft to signed, with renewal reminders.">{manage && <Link href="/contracts/templates" className="btn-ghost">Templates</Link>}</PageHead>
        {rows.length === 0 ? <Empty title="No contracts yet" /> : <div className="card overflow-x-auto !p-0"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-muted"><tr><th className="p-3">No.</th><th>Client</th><th>Title</th><th>Value</th><th>Ends</th><th>Status</th></tr></thead>
          <tbody className="divide-y divide-line">{rows.map((r: any) => <tr key={r.id}><td className="p-3"><Link className="underline" href={`/contracts/${r.id}`}>{r.number}</Link></td><td>{r.client}</td><td>{r.title}</td><td className="tabular-nums">{formatMoney(r.valueMinor, p.org.currency, p.org.locale)}</td><td>{r.ends_on}</td><td><span className={`badge ${TONE[r.effective] ?? ''}`}>{r.effective}</span></td></tr>)}</tbody></table></div>}
        {manage && <section className="card"><h2 className="font-semibold">New contract</h2>
          {tpls.length === 0 && <ActionForm action={starter as any} submit="Add starter templates (advertising, sponsorship)" tone="ghost" className="mt-2"><span /></ActionForm>}
          {accounts.length === 0 ? <p className="mt-2 text-sm text-muted">Add a client in the CRM first.</p> :
            <ActionForm action={create as any} submit="Create contract" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-2">
              <Select label="Client" name="accountId" required allowEmpty={false} options={accounts.map((a: any) => ({ value: a.id, label: a.name }))} />
              <Select label="Template" name="templateId" options={tpls.filter((t: any) => t.active).map((t: any) => ({ value: t.id, label: t.name }))} />
              <Field label="Title" name="title" required placeholder="e.g. 2026 Morning Drive spots" /><Field label="Value" name="value" placeholder="1500000" />
              <Field label="Starts" name="startsOn" type="date" required /><Field label="Ends" name="endsOn" type="date" required /></div></ActionForm>}</section>}
      </div>
    );
  });
}
