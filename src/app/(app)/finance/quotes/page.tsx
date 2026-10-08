import Link from 'next/link';
import { page, mutate, field } from '@/server/session';
import { createQuote, listQuotes } from '@/server/quotes';
import { listParties } from '@/server/finance';
import { formatMoney } from '@/domain/finance';
import { ActionForm, Field, Select } from '@/components/forms';
import { PageHead, Empty } from '@/components/ui';

export const metadata = { title: 'Proposals & estimates' };
export const dynamic = 'force-dynamic';

const ROWS = [1, 2, 3, 4, 5];
async function create(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/finance/quotes'], async (c) => {
    const lines = ROWS.map((n) => ({ description: field(f, `d${n}`), qty: Number(field(f, `q${n}`) || 1), unit: field(f, `u${n}`) })).filter((l) => l.description || l.unit);
    const r = await createQuote(c, { kind: field(f, 'kind'), partyId: field(f, 'partyId'), title: field(f, 'title'), lines, notes: field(f, 'notes'), vat: field(f, 'vat') === 'yes', validUntil: field(f, 'validUntil') });
    return `Created ${r.number}.`;
  });
}
const TONE: Record<string, string> = { accepted: 'bg-emerald-100 text-emerald-900', converted: 'bg-indigo-100 text-indigo-900', sent: 'bg-sky-100 text-sky-900', declined: 'bg-red-100 text-red-900', draft: 'bg-amber-100 text-amber-900' };

export default async function Quotes({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const sp = await searchParams;
  return page(async (p) => {
    p.requireFeature('finance');
    const kind = sp.kind === 'proposal' || sp.kind === 'estimate' ? sp.kind : undefined;
    const rows = await listQuotes(p.ctx, kind);
    const manage = p.allowed('quote:manage');
    const clients = manage ? (await listParties(p.ctx.q)).filter((x: any) => x.kind === 'client') : [];
    const tab = (k: string | undefined, label: string) => <Link key={label} href={k ? `?kind=${k}` : '?'} className={`btn ${kind === k ? 'bg-brand text-white' : 'btn-ghost'}`}>{label}</Link>;
    return (
      <div className="mx-auto max-w-4xl space-y-5">
        <PageHead title="Proposals & estimates" sub="Price work for clients. When accepted, turn it into an invoice in one step.">{tab(undefined, 'All')}{tab('proposal', 'Proposals')}{tab('estimate', 'Estimates')}</PageHead>
        {rows.length === 0 ? <Empty title="Nothing here yet" /> : <div className="card overflow-x-auto !p-0"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-muted"><tr><th className="p-3">No.</th><th>Client</th><th>Title</th><th>Total</th><th>Valid until</th><th>Status</th></tr></thead>
          <tbody className="divide-y divide-line">{rows.map((r: any) => <tr key={r.id}><td className="p-3"><Link className="underline" href={`/finance/quotes/${r.id}`}>{r.number}</Link></td><td>{r.client}</td><td>{r.title}</td><td className="tabular-nums">{formatMoney(r.totalMinor, p.org.currency, p.org.locale)}</td><td>{r.valid_until}{r.lapsed ? ' (lapsed)' : ''}</td><td><span className={`badge ${TONE[r.status] ?? ''}`}>{r.status}</span></td></tr>)}</tbody></table></div>}
        {manage && <section className="card"><h2 className="font-semibold">New proposal or estimate</h2>
          {clients.length === 0 ? <p className="mt-2 text-sm text-muted">Add a client under Finance setup first.</p> :
            <ActionForm action={create as any} submit="Create" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-2">
              <Select label="Type" name="kind" allowEmpty={false} options={[{ value: 'proposal', label: 'Proposal' }, { value: 'estimate', label: 'Estimate' }]} />
              <Select label="Client" name="partyId" required allowEmpty={false} options={clients.map((x: any) => ({ value: x.id, label: x.name }))} />
              <Field label="Title" name="title" required /><Field label="Valid until" name="validUntil" type="date" required />
              <Select label="VAT" name="vat" allowEmpty={false} defaultValue="yes" options={[{ value: 'yes', label: 'Add VAT' }, { value: 'no', label: 'No VAT' }]} /></div>
              <p className="label mt-2">Items (up to 5 here)</p>
              {ROWS.map((n) => <div key={n} className="grid gap-x-3 sm:grid-cols-[1fr_6rem_9rem]"><Field label={`Item ${n}`} name={`d${n}`} /><Field label="Qty" name={`q${n}`} type="number" defaultValue="1" /><Field label="Unit price" name={`u${n}`} /></div>)}
              <Field label="Notes" name="notes" /></ActionForm>}</section>}
      </div>
    );
  });
}
