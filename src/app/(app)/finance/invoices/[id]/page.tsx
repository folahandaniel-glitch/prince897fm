import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page, mutate, field } from '@/server/session';
import { approveInvoice, getInvoice, recordInvoicePayment, voidInvoice } from '@/server/invoices';
import { listAccounts } from '@/server/finance';
import { need, UserError } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';
import { Money } from '@/components/money';
import { PrintButton } from '@/components/print-button';

export const metadata = { title: 'Invoice' };
export const dynamic = 'force-dynamic';

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  async function approve(_p: unknown) { 'use server'; return mutate([`/finance/invoices/${id}`], async (c) => { await approveInvoice(c, id); return 'Approved. It can now be paid.'; }); }
  async function pay(_p: unknown, f: FormData) { 'use server'; return mutate([`/finance/invoices/${id}`, '/finance/invoices'], async (c) => { const r = await recordInvoicePayment(c, id, { cashAccountId: field(f, 'cashAccountId'), cash: field(f, 'cash'), wht: field(f, 'wht'), reference: field(f, 'reference'), date: field(f, 'date') }); return r.settled ? 'Recorded. The invoice is fully settled.' : 'Recorded. A balance remains.'; }); }
  async function voidIt(_p: unknown, f: FormData) { 'use server'; return mutate([`/finance/invoices/${id}`, '/finance/invoices'], async (c) => { await voidInvoice(c, id, field(f, 'reason')); return 'Voided with a reversing entry.'; }); }
  return page(async (p) => {
    p.requireFeature('finance');
    need(p.ctx, 'finance:view');
    let d; try { d = await getInvoice(p.ctx, id); } catch (e) { if (e instanceof UserError) notFound(); throw e; }
    const accts = await listAccounts(p.ctx.q);
    const { inv, payments } = d;
    const k = { cur: p.org.currency, loc: p.org.locale };
    const rec = inv.kind === 'receivable';
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3"><div><Link href={`/finance/invoices?kind=${inv.kind}`} className="text-sm underline">← {rec ? 'Invoices' : 'Bills'}</Link><h1 className="text-2xl font-bold">{inv.number}</h1><p className="text-muted">{inv.party} · {inv.description}</p></div><PrintButton /></header>
        <section className="card grid gap-3 sm:grid-cols-4"><div><p className="label">Subtotal</p><Money v={inv.subtotalMinor} {...k} /></div><div><p className="label">VAT</p><Money v={inv.vatMinor} {...k} /></div><div><p className="label">Total</p><Money v={inv.totalMinor} {...k} className="font-semibold" /></div><div><p className="label">Balance</p><Money v={inv.status === 'void' ? 0 : inv.balanceMinor} {...k} className="font-semibold" /></div>
          <div><p className="label">Issued</p>{inv.issue}</div><div><p className="label">Due</p>{inv.due}</div><div><p className="label">Account</p>{inv.cat_code} {inv.category}</div><div><p className="label">Status</p>{inv.status}</div></section>
        {payments.length > 0 && <section className="card overflow-x-auto"><h2 className="font-semibold">{rec ? 'Receipts' : 'Payments'}</h2><table className="mt-2 w-full min-w-[30rem]"><thead><tr className="border-b border-line"><th className="th">Date</th><th className="th">Account</th><th className="th">Reference</th><th className="th text-right">Cash</th><th className="th text-right">WHT</th></tr></thead><tbody>{payments.map((x: any) => <tr key={x.id} className="border-b border-line last:border-0"><td className="td">{x.paid}</td><td className="td">{x.account}</td><td className="td">{x.reference}</td><td className="td text-right"><Money v={x.cashMinor} {...k} /></td><td className="td text-right"><Money v={x.whtMinor} {...k} /></td></tr>)}</tbody></table></section>}
        {inv.status === 'pending' && p.allowed('finance:approve') && <section className="card"><h2 className="font-semibold">Approve this bill</h2><p className="mt-1 text-sm text-muted">You cannot approve a bill you recorded. Larger bills need the senior approver set in the approval bands.</p><ActionForm action={approve as any} submit="Approve bill" className="mt-2"><span /></ActionForm></section>}
        {inv.status === 'open' && p.allowed('finance:pay') && <section className="card"><h2 className="font-semibold">{rec ? 'Record a receipt' : 'Record a payment'}</h2>
          <p className="mt-1 text-sm text-muted">Cash {rec ? 'received' : 'paid'} plus tax withheld together reduce the balance. Suggested withholding tax on the full amount: <Money v={d.suggestedWhtMinor} {...k} /> (check with your accountant whether it applies).</p>
          <ActionForm action={pay as any} submit={rec ? 'Record receipt' : 'Record payment'} className="mt-3"><div className="grid gap-x-4 sm:grid-cols-2">
            <Select label="Cash or bank account" name="cashAccountId" required allowEmpty={false} options={accts.filter((a: any) => a.active && a.is_cash).map((a: any) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
            <Field label="Date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
            <Field label={rec ? 'Cash received (₦)' : 'Cash paid (₦)'} name="cash" placeholder="0.00" /><Field label="Tax withheld (₦, optional)" name="wht" placeholder="0.00" />
            <Field label="Reference" name="reference" required hint="Receipt, transfer or cheque number." /></div></ActionForm></section>}
        {inv.status !== 'void' && payments.length === 0 && p.allowed('finance:reverse') && <section className="card"><h2 className="font-semibold">Void</h2><ActionForm action={voidIt as any} submit="Void with reversing entry" tone="danger" confirm="Void this invoice? A reversing journal entry is posted." className="mt-2"><Field label="Reason (at least 10 characters)" name="reason" required /></ActionForm></section>}
      </div>
    );
  });
}
