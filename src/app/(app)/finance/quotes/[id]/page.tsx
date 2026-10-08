import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { page, mutate, field } from '@/server/session';
import { convertToInvoice, getQuote, setQuoteStatus } from '@/server/quotes';
import { listAccounts } from '@/server/finance';
import { formatMoney, fromDb } from '@/domain/finance';
import { ActionForm, Field, Select } from '@/components/forms';
import { PrintButton } from '@/components/print-button';
import { PageHead } from '@/components/ui';

export const dynamic = 'force-dynamic';

async function status(_p: unknown, f: FormData) { 'use server'; return mutate(['/finance/quotes'], async (c) => { await setQuoteStatus(c, field(f, 'id'), field(f, 'intent') as 'sent' | 'accepted' | 'declined'); return 'Updated.'; }); }
async function convert(_p: unknown, f: FormData) {
  'use server';
  let to = '';
  const r = await mutate(['/finance/quotes', '/finance/invoices'], async (c) => { const inv = await convertToInvoice(c, field(f, 'id'), { categoryId: field(f, 'categoryId'), dueDate: field(f, 'dueDate') }); to = `/finance/invoices/${inv.id}`; });
  if (!r?.error && to) redirect(to);
  return r;
}

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return page(async (p) => {
    p.requireFeature('finance');
    const q = await getQuote(p.ctx, id);
    if (!q) notFound();
    const m = (n: number) => formatMoney(n, p.org.currency, p.org.locale);
    const manage = p.allowed('quote:manage');
    const income = manage && q.status === 'accepted' ? (await listAccounts(p.ctx.q)).filter((a: any) => a.type === 'income' && a.active) : [];
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHead title={`${q.number}: ${q.title}`} sub={`${q.kind} for ${q.client} · valid until ${q.valid_s} · ${q.status}`}><PrintButton /><Link href="/finance/quotes" className="btn-ghost no-print">All</Link></PageHead>
        <section className="card"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-muted"><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Unit</th><th className="text-right">Amount</th></tr></thead>
          <tbody className="divide-y divide-line">{(q.lines as any[]).map((l, i) => { const u = fromDb(l.unit); return <tr key={i}><td className="py-2">{l.description}</td><td className="text-right tabular-nums">{l.qty}</td><td className="text-right tabular-nums">{m(u)}</td><td className="text-right tabular-nums">{m(Math.round(l.qty * u))}</td></tr>; })}</tbody>
          <tfoot className="text-sm"><tr><td colSpan={3} className="pt-3 text-right text-muted">Subtotal</td><td className="pt-3 text-right tabular-nums">{m(q.subtotalMinor)}</td></tr><tr><td colSpan={3} className="text-right text-muted">VAT</td><td className="text-right tabular-nums">{m(q.vatMinor)}</td></tr><tr className="font-bold"><td colSpan={3} className="text-right">Total</td><td className="text-right tabular-nums">{m(q.totalMinor)}</td></tr></tfoot></table>
          {q.notes && <p className="mt-3 text-sm text-muted">{q.notes}</p>}{q.invoice_no && <p className="mt-3 text-sm">Invoiced as <b>{q.invoice_no}</b>.</p>}</section>
        {manage && ['draft', 'sent'].includes(q.status) && <section className="card no-print"><ActionForm action={status as any} submit="Mark accepted" buttons={[...(q.status === 'draft' ? [{ label: 'Mark as sent', value: 'sent', tone: 'ghost' as const }] : []), { label: 'Client accepted', value: 'accepted' }, { label: 'Client declined', value: 'declined', tone: 'danger' }]}><input type="hidden" name="id" value={q.id} /></ActionForm></section>}
        {manage && q.status === 'accepted' && <section className="card no-print"><h2 className="font-semibold">Turn into an invoice</h2><ActionForm action={convert as any} submit="Create invoice" className="mt-3"><input type="hidden" name="id" value={q.id} /><div className="grid gap-x-4 sm:grid-cols-2"><Select label="Income account" name="categoryId" required allowEmpty={false} options={income.map((a: any) => ({ value: a.id, label: `${a.code} ${a.name}` }))} /><Field label="Payment due" name="dueDate" type="date" required /></div></ActionForm></section>}
      </div>
    );
  });
}
