import Link from 'next/link';
import { page, mutate, field, optional } from '@/server/session';
import { createOrder, listOrders, PO_LABEL } from '@/server/orders';
import { listParties } from '@/server/finance';
import { need } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';
import { Money } from '@/components/money';
import { Empty } from '@/components/ui';

export const metadata = { title: 'Purchase orders' };
export const dynamic = 'force-dynamic';

async function create(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/finance/orders'], async (c) => { const r = await createOrder(c, { vendorId: field(f, 'vendor'), description: field(f, 'description'), subtotal: field(f, 'amount'), expectedOn: optional(f, 'expected') ?? undefined }); return `${r.number} raised. Someone else must approve it before it is sent.`; });
}

export default async function Orders() {
  return page(async (p) => {
    p.requireFeature('finance');
    need(p.ctx, 'finance:view');
    const [rows, parties] = await Promise.all([listOrders(p.ctx), listParties(p.ctx.q)]);
    const k = { cur: p.org.currency, loc: p.org.locale };
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-bold">Purchase orders</h1>
        <p className="text-sm text-muted">Raise, approve (by someone else), confirm receipt (by someone who did neither), then turn it into a vendor bill.</p>
        {rows.length === 0 ? <Empty title="No purchase orders yet" text="Raise one below before committing to a purchase." /> : (
          <div className="card overflow-x-auto p-0"><table className="w-full min-w-[40rem]"><thead><tr className="border-b border-line"><th className="th">No.</th><th className="th">Vendor</th><th className="th">For</th><th className="th text-right">Amount</th><th className="th">Status</th></tr></thead>
            <tbody>{rows.map((o: any) => <tr key={o.id} className="border-b border-line last:border-0"><td className="td"><Link className="font-medium underline" href={`/finance/orders/${o.id}`}>{o.number}</Link></td><td className="td">{o.vendor}</td><td className="td">{o.description}</td><td className="td text-right"><Money v={o.subtotalMinor} {...k} /></td><td className="td"><span className="badge">{PO_LABEL[o.status]}</span></td></tr>)}</tbody></table></div>)}
        {p.allowed('finance:create') && <section className="card"><h2 className="font-semibold">Raise a purchase order</h2><ActionForm action={create as any} submit="Raise order" className="mt-3">
          <Select label="Vendor" name="vendor" required allowEmpty={false} options={parties.filter((x: any) => x.kind === 'vendor').map((x: any) => ({ value: x.id, label: x.name }))} />
          <Field label="What is being ordered" name="description" required />
          <div className="grid gap-x-4 sm:grid-cols-2"><Field label="Amount before VAT (₦)" name="amount" required /><Field label="Expected on" name="expected" type="date" /></div></ActionForm></section>}
      </div>
    );
  });
}
