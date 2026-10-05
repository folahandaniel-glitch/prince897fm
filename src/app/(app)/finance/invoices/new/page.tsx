import { page, mutate, field, optional } from '@/server/session';
import { createInvoice, getTaxSettings } from '@/server/invoices';
import { listAccounts, listParties } from '@/server/finance';
import { listAccounts as crmAccounts } from '@/server/crm';
import { need } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';

export const metadata = { title: 'New invoice or bill' };
export const dynamic = 'force-dynamic';

async function create(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/finance/invoices'], async (c) => {
    const r = await createInvoice(c, { kind: field(f, 'kind') as any, partyId: optional(f, 'partyId') ?? undefined, crmAccountId: optional(f, 'crmAccountId') ?? undefined, description: field(f, 'description'), categoryId: field(f, 'categoryId'), issueDate: field(f, 'issueDate'), dueDate: field(f, 'dueDate'), subtotal: field(f, 'subtotal'), vat: field(f, 'vat') === 'on' });
    return `${r.number} recorded.${field(f, 'kind') === 'payable' ? ' It must be approved by someone else before it can be paid.' : ''}`;
  });
}

export default async function NewInvoice({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const sp = await searchParams;
  const kind = sp.kind === 'payable' ? 'payable' : 'receivable';
  return page(async (p) => {
    p.requireFeature('finance');
    need(p.ctx, 'finance:create');
    const [accts, parties, tax, crm] = await Promise.all([listAccounts(p.ctx.q), listParties(p.ctx.q), getTaxSettings(p.ctx.q), kind === 'receivable' && p.feature('crm') && p.allowed('crm:view') ? crmAccounts(p.ctx, { status: 'client' }) : Promise.resolve([])]);
    const today = new Date().toISOString().slice(0, 10);
    const due = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <h1 className="text-2xl font-bold">{kind === 'receivable' ? 'New invoice' : 'Record a vendor bill'}</h1>
        <p className="text-sm text-muted">{kind === 'receivable' ? 'Raises a receivable on the ledger. Record receipts against it when the client pays.' : 'Records a payable on the ledger. Another person must approve it, and a third person (not the one who recorded or approved it) pays it.'}</p>
        <div className="card"><ActionForm action={create as any} submit="Save">
          <input type="hidden" name="kind" value={kind} />
          {crm.length > 0 && <Select label="CRM client (optional: fills the finance client)" name="crmAccountId" options={crm.map((a: any) => ({ value: a.id, label: a.name }))} />}
          <Select label={kind === 'receivable' ? 'Finance client (if not chosen above)' : 'Vendor'} name="partyId" options={parties.filter((x: any) => x.kind === (kind === 'receivable' ? 'client' : 'vendor')).map((x: any) => ({ value: x.id, label: x.name }))} />
          <Field label="Description" name="description" required placeholder={kind === 'receivable' ? 'e.g. Spot advert package, March' : 'e.g. Transmitter servicing'} />
          <Select label={kind === 'receivable' ? 'Income account' : 'Expense account'} name="categoryId" required allowEmpty={false} options={accts.filter((a: any) => a.active && a.type === (kind === 'receivable' ? 'income' : 'expense')).map((a: any) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
          <div className="grid gap-x-4 sm:grid-cols-3"><Field label="Amount before VAT (₦)" name="subtotal" required placeholder="250,000.00" /><Field label="Issue date" name="issueDate" type="date" required defaultValue={today} /><Field label="Due date" name="dueDate" type="date" required defaultValue={due} /></div>
          <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" name="vat" /> Add VAT at {tax.vatRate}% (rate set in Tax settings)</label>
        </ActionForm></div>
      </div>
    );
  });
}
