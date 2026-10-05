import { page, mutate, field, optional } from '@/server/session';
import { addParty, createTransaction, listAccounts, listParties } from '@/server/finance';
import { listStructure } from '@/server/hr';
import { need } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';

export const metadata = { title: 'New transaction' };
export const dynamic = 'force-dynamic';

async function create(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/finance'], async (c) => {
    const r = await createTransaction(c, {
      kind: field(f, 'kind'), title: field(f, 'title'), description: field(f, 'description'), partyId: optional(f, 'partyId'), categoryId: field(f, 'categoryId'),
      cashAccountId: optional(f, 'cashAccountId'), amount: field(f, 'amount'), date: field(f, 'date'), departmentId: optional(f, 'departmentId'), submit: field(f, 'intent') === 'submit',
    });
    return `${r.number} ${field(f, 'intent') === 'submit' ? 'submitted for review' : 'saved as a draft'}. Open it from the finance desk to attach documents.`;
  });
}
async function party(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/finance/new'], async (c) => { await addParty(c, field(f, 'kind') as any, field(f, 'name'), field(f, 'phone'), field(f, 'email')); return 'Added.'; });
}

export default async function NewTransaction() {
  return page(async (p) => {
    need(p.ctx, 'finance:create');
    const [accts, parties, st] = await Promise.all([listAccounts(p.ctx.q), listParties(p.ctx.q), listStructure(p.ctx.q)]);
    const opt = (rows: any[]) => rows.map((a) => ({ value: a.id, label: `${a.code ? a.code + ' · ' : ''}${a.name}` }));
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <h1 className="text-2xl font-bold">New transaction</h1>
        <p className="text-sm text-muted">Nothing hits the ledger until it has been reviewed and approved. You cannot review, approve or pay your own transaction.</p>
        <div className="card"><ActionForm action={create as any} submit="Save draft" buttons={[{ label: 'Save draft', value: 'draft', tone: 'ghost' }, { label: 'Submit for review', value: 'submit' }]}>
          <Select label="Type" name="kind" allowEmpty={false} defaultValue="expense" options={[{ value: 'expense', label: 'Expense / payment request' }, { value: 'income', label: 'Income received' }, { value: 'transfer', label: 'Transfer between cash/bank accounts' }]} />
          <Field label="Title" name="title" required placeholder="e.g. Studio microphone cables" />
          <div className="grid gap-x-4 sm:grid-cols-2"><Field label="Amount (₦)" name="amount" required placeholder="150,000.00" hint="Exact amount, up to 2 decimals." /><Field label="Date" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></div>
          <Select label="Category (expense/income account) or transfer destination" name="categoryId" required allowEmpty={false} options={opt(accts.filter((a: any) => a.active && a.type !== 'liability' && a.type !== 'equity'))} />
          <Select label="Cash/bank account (income: received into; transfer: paid from; not needed for expenses)" name="cashAccountId" options={opt(accts.filter((a: any) => a.active && a.is_cash))} />
          <Select label="Vendor or client" name="partyId" options={parties.map((x: any) => ({ value: x.id, label: `${x.name} (${x.kind})` }))} />
          <Select label={p.terms.department?.singular ?? 'Department'} name="departmentId" options={st.departments.filter((d: any) => !d.archived_at).map((d: any) => ({ value: d.id, label: d.name }))} />
          <div className="mb-1"><label className="label" htmlFor="description">Details / justification</label><textarea id="description" name="description" rows={3} className="input py-2" /></div>
        </ActionForm></div>
        <section className="card" aria-labelledby="pt"><h2 id="pt" className="font-semibold">Add a vendor or client</h2>
          <ActionForm action={party as any} submit="Add" tone="ghost" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-4">
            <Select label="Type" name="kind" allowEmpty={false} defaultValue="vendor" options={[{ value: 'vendor', label: 'Vendor' }, { value: 'client', label: 'Client' }]} /><Field label="Name" name="name" required /><Field label="Phone" name="phone" /><Field label="Email" name="email" type="email" /></div></ActionForm></section>
      </div>
    );
  });
}
