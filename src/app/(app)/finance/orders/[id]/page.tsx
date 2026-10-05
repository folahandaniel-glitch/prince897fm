import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page, mutate, field } from '@/server/session';
import { approveOrder, billOrder, cancelOrder, getOrder, PO_LABEL, receiveOrder } from '@/server/orders';
import { listAccounts } from '@/server/finance';
import { need } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';
import { Money } from '@/components/money';
import { PrintButton } from '@/components/print-button';

export const metadata = { title: 'Purchase order' };
export const dynamic = 'force-dynamic';

export default async function Order({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const paths = [`/finance/orders/${id}`, '/finance/orders'];
  async function approve() { 'use server'; return mutate(paths, async (c) => { await approveOrder(c, id); return 'Approved.'; }); }
  async function receive(_p: unknown, f: FormData) { 'use server'; return mutate(paths, async (c) => { await receiveOrder(c, id, field(f, 'note')); return 'Receipt confirmed.'; }); }
  async function bill(_p: unknown, f: FormData) { 'use server'; return mutate([...paths, '/finance/invoices'], async (c) => { const r = await billOrder(c, id, { categoryId: field(f, 'category'), vat: field(f, 'vat') === 'on', dueDate: field(f, 'due') }); return `Bill ${r.number} recorded. It now needs approval and payment.`; }); }
  async function cancel(_p: unknown, f: FormData) { 'use server'; return mutate(paths, async (c) => { await cancelOrder(c, id, field(f, 'reason')); return 'Cancelled.'; }); }
  return page(async (p) => {
    p.requireFeature('finance');
    need(p.ctx, 'finance:view');
    const o = await getOrder(p.ctx, id);
    if (!o) notFound();
    const accts = o.status === 'received' ? await listAccounts(p.ctx.q) : [];
    const k = { cur: p.org.currency, loc: p.org.locale };
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3"><div><Link href="/finance/orders" className="text-sm underline">← Purchase orders</Link><h1 className="text-2xl font-bold">{o.number}</h1><p className="text-muted">{o.vendor} · {o.description}</p></div><PrintButton /></header>
        <section className="card grid gap-3 sm:grid-cols-4"><div><p className="label">Amount (before VAT)</p><Money v={o.subtotalMinor} {...k} className="font-semibold" /></div><div><p className="label">Status</p>{PO_LABEL[o.status]}</div><div><p className="label">Expected</p>{o.expected ?? '–'}</div><div><p className="label">Bill</p>{o.invoice_id ? <Link className="underline" href={`/finance/invoices/${o.invoice_id}`}>{o.invoice_no}</Link> : '–'}</div>
          {o.receipt_note && <div className="sm:col-span-4"><p className="label">Receipt note</p>{o.receipt_note}</div>}{o.cancel_reason && <div className="sm:col-span-4"><p className="label">Cancelled because</p>{o.cancel_reason}</div>}</section>
        {o.status === 'draft' && p.allowed('finance:approve') && <section className="card"><h2 className="font-semibold">Approve</h2><p className="mt-1 text-sm text-muted">You cannot approve an order you raised.</p><ActionForm action={approve as any} submit="Approve order" className="mt-2"><span /></ActionForm></section>}
        {o.status === 'approved' && <section className="card"><h2 className="font-semibold">Confirm receipt</h2><p className="mt-1 text-sm text-muted">Done by someone who neither raised nor approved the order.</p><ActionForm action={receive as any} submit="Confirm received" className="mt-2"><Field label="What was received" name="note" required /></ActionForm></section>}
        {o.status === 'received' && p.allowed('finance:create') && <section className="card"><h2 className="font-semibold">Turn into a vendor bill</h2><ActionForm action={bill as any} submit="Create bill" className="mt-2"><div className="grid gap-x-4 sm:grid-cols-2"><Select label="Expense account" name="category" required allowEmpty={false} options={accts.filter((a: any) => a.active && a.type === 'expense').map((a: any) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} /><Field label="Due date" name="due" type="date" required defaultValue={new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)} /></div><label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" name="vat" /> Add VAT</label></ActionForm></section>}
        {['draft', 'approved'].includes(o.status) && p.allowed('finance:create') && <section className="card"><h2 className="font-semibold">Cancel</h2><ActionForm action={cancel as any} submit="Cancel order" tone="danger" confirm="Cancel this purchase order?" className="mt-2"><Field label="Reason" name="reason" required /></ActionForm></section>}
      </div>
    );
  });
}
