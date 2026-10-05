import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page, mutate, field } from '@/server/session';
import { addAttachment, approveTransaction, getTransaction, listAccounts, payTransaction, reconcileTransaction, reviewTransaction, submitDraft, voidTransaction } from '@/server/finance';
import { sodViolation } from '@/domain/finance';
import { ActionForm, Field, Select } from '@/components/forms';
import { Money, StatusBadge } from '@/components/money';

export const dynamic = 'force-dynamic';

const paths = (id: string) => [`/finance/${id}`, '/finance'];
async function submit(_p: unknown, f: FormData) { 'use server'; const id = field(f, 'id'); return mutate(paths(id), async (c) => { await submitDraft(c, id); return 'Submitted for review.'; }); }
async function review(_p: unknown, f: FormData) {
  'use server'; const id = field(f, 'id'); const d = field(f, 'intent') as 'approve' | 'return' | 'reject';
  return mutate(paths(id), async (c) => { await reviewTransaction(c, id, d, field(f, 'note')); return d === 'approve' ? 'Reviewed.' : d === 'return' ? 'Returned to the creator.' : 'Rejected.'; });
}
async function approve(_p: unknown, f: FormData) {
  'use server'; const id = field(f, 'id'); const d = field(f, 'intent') as 'approve' | 'reject';
  return mutate(paths(id), async (c) => { const s = await approveTransaction(c, id, d, field(f, 'note')); return s === 'approved' ? 'Fully approved. Ready for payment.' : s === 'reviewed' ? 'Approved. Waiting for the next approver.' : 'Rejected.'; });
}
async function pay(_p: unknown, f: FormData) { 'use server'; const id = field(f, 'id'); return mutate(paths(id), async (c) => { await payTransaction(c, id, { cashAccountId: field(f, 'cashAccountId'), reference: field(f, 'reference') }); return 'Payment recorded.'; }); }
async function reconcile(_p: unknown, f: FormData) { 'use server'; const id = field(f, 'id'); return mutate(paths(id), async (c) => { await reconcileTransaction(c, id, field(f, 'statementRef')); return 'Reconciled.'; }); }
async function voidIt(_p: unknown, f: FormData) { 'use server'; const id = field(f, 'id'); return mutate(paths(id), async (c) => { await voidTransaction(c, id, field(f, 'reason')); return 'Voided. Reversing entries were posted; the original history is kept.'; }); }
async function attach(_p: unknown, f: FormData) {
  'use server'; const id = field(f, 'id'); const file = f.get('file');
  return mutate(paths(id), async (c) => {
    if (!(file instanceof File) || file.size === 0) throw new (await import('@/server/ctx')).UserError('Choose a file.');
    await addAttachment(c, id, file.name, Buffer.from(await file.arrayBuffer()));
    return 'Document attached and fingerprinted.';
  });
}

export default async function TxnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return page(async (p) => {
    const d = await getTransaction(p.ctx, id);
    if (!d) notFound();
    const { txn: t, approvals, entries, files } = d;
    const me = p.ctx.userId;
    const approvers = (approvals as any[]).filter((a) => a.action === 'approved').length;
    const roles = p.ctx.subject.grants.map((g) => g.roleKey);
    const steps: string[] = t.approval_steps ?? [];
    const k = { cur: t.currency, loc: p.org.locale };
    const isCreator = t.created_by === me;
    const canReview = t.status === 'submitted' && p.allowed('finance:review') && !isCreator;
    const canApprove = t.status === 'reviewed' && p.allowed('finance:approve') && roles.includes(steps[t.approval_index]) && t.created_by !== me && t.reviewed_by !== me;
    const approverIds = (approvals as any[]).filter((a) => a.action === 'approved').map((a) => a.actor_user_id);
    const canPay = t.status === 'approved' && p.allowed('finance:pay') && !sodViolation(me, 'pay', { creator: t.created_by, reviewer: t.reviewed_by, approvers: approverIds });
    const canRec = ['paid', 'posted'].includes(t.status) && p.allowed('finance:reconcile') && t.created_by !== me && t.paid_by !== me && !(t.kind === 'income' && t.reviewed_by === me);
    const accts = canPay ? (await listAccounts(p.ctx.q)).filter((a: any) => a.is_cash && a.active) : [];
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <nav className="text-sm text-muted" aria-label="Breadcrumb"><Link className="underline" href="/finance">Finance desk</Link> / {t.number}</nav>
        <header className="card">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm text-muted">{t.kind} · {t.number}</p><h1 className="text-xl font-bold">{t.title}</h1></div><StatusBadge s={t.status} /></div>
          <p className="mt-2 text-3xl font-bold"><Money v={t.amountMinor} {...k} /></p>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            <div><dt className="text-muted">Date</dt><dd>{String(t.d)}</dd></div><div><dt className="text-muted">Category</dt><dd>{t.category}</dd></div><div><dt className="text-muted">Party</dt><dd>{t.party ?? '—'}</dd></div>
            <div><dt className="text-muted">Department</dt><dd>{t.department ?? '—'}</dd></div><div><dt className="text-muted">Created by</dt><dd>{t.creator}</dd></div><div><dt className="text-muted">Account</dt><dd>{t.cashAccount ?? '—'}</dd></div>
            {t.payment_ref && <div><dt className="text-muted">Payment reference</dt><dd>{t.payment_ref}</dd></div>}{t.statement_ref && <div><dt className="text-muted">Statement ref</dt><dd>{t.statement_ref}</dd></div>}
          </dl>
          {t.description && <p className="mt-3 whitespace-pre-wrap text-sm">{t.description}</p>}
          {t.status === 'void' && <p className="mt-3 rounded-lg border border-red-600 p-3 text-sm">Voided: {t.void_reason}</p>}
          {t.status === 'reviewed' && steps.length > 0 && <p className="mt-3 text-sm text-muted">Approval stage {t.approval_index + 1} of {steps.length}: waiting for <strong>{steps[t.approval_index].replace(/_/g, ' ')}</strong>. {approvers} approved so far.</p>}
        </header>

        {(isCreator && t.status === 'draft') && <section className="card"><ActionForm action={submit as any} submit="Submit for review"><input type="hidden" name="id" value={id} /><p className="text-sm text-muted">This is a draft. Attach supporting documents below, then submit.</p></ActionForm></section>}
        {canReview && <section className="card" aria-label="Review"><h2 className="font-semibold">Review</h2><ActionForm action={review as any} submit="Approve" className="mt-2" buttons={[{ label: 'Pass to approval', value: 'approve' }, { label: 'Return', value: 'return', tone: 'ghost' }, { label: 'Reject', value: 'reject', tone: 'danger' }]}><input type="hidden" name="id" value={id} /><Field label="Note (required to return or reject)" name="note" /></ActionForm></section>}
        {canApprove && <section className="card" aria-label="Approval"><h2 className="font-semibold">Approval: stage {t.approval_index + 1} of {steps.length}</h2><ActionForm action={approve as any} submit="Approve" className="mt-2" buttons={[{ label: 'Approve', value: 'approve' }, { label: 'Reject', value: 'reject', tone: 'danger' }]}><input type="hidden" name="id" value={id} /><Field label="Note (required to reject)" name="note" /></ActionForm></section>}
        {canPay && <section className="card" aria-label="Payment"><h2 className="font-semibold">Record payment</h2><p className="text-sm text-muted">This records that the money was paid. It does not move money from a bank. The account balance must cover the amount.</p>
          <ActionForm action={pay as any} submit="Record payment" className="mt-2"><input type="hidden" name="id" value={id} /><Select label="Pay from" name="cashAccountId" required allowEmpty={false} options={accts.map((a: any) => ({ value: a.id, label: a.name }))} /><Field label="Payment reference" name="reference" required placeholder="Bank transfer / receipt / cheque number" /></ActionForm></section>}
        {canRec && <section className="card" aria-label="Reconcile"><h2 className="font-semibold">Reconcile</h2><ActionForm action={reconcile as any} submit="Mark reconciled" className="mt-2"><input type="hidden" name="id" value={id} /><Field label="Bank statement line / reference matched" name="statementRef" required /></ActionForm></section>}

        <section className="card" aria-labelledby="trail"><h2 id="trail" className="font-semibold">Approval trail</h2>
          <ol className="mt-2 space-y-2 text-sm">{approvals.map((a: any, i: number) => <li key={i} className="border-l-2 border-brand pl-3"><strong className="capitalize">{a.action}</strong>{a.step != null ? ` (stage ${a.step + 1})` : ''} · {a.actor} · {new Date(a.created_at).toLocaleString(p.org.locale, { timeZone: p.org.timezone })}{a.note && <span className="block text-muted">{a.note}</span>}</li>)}</ol></section>

        <section className="card" aria-labelledby="docs"><h2 id="docs" className="font-semibold">Supporting documents</h2>
          {files.length === 0 ? <p className="mt-2 text-sm text-muted">No documents attached. Add the invoice, receipt or quotation.</p> : <ul className="mt-2 divide-y divide-line text-sm">{files.map((f: any) => <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><a className="underline" href={`/api/finance/attachment/${f.id}`}>{f.filename}</a><span className="text-xs text-muted">{Math.round(f.size_bytes / 1024)} KB · fingerprint {f.sha256.slice(0, 12)}…</span></li>)}</ul>}
          {!['void', 'rejected'].includes(t.status) && <ActionForm action={attach as any} submit="Attach" tone="ghost" className="mt-3"><input type="hidden" name="id" value={id} /><div><label className="label" htmlFor="file">PDF, PNG or JPEG, up to 2 MB</label><input id="file" name="file" type="file" accept="application/pdf,image/png,image/jpeg" capture="environment" className="input py-2" /></div></ActionForm>}</section>

        <section className="card" aria-labelledby="je"><h2 id="je" className="font-semibold">Ledger entries</h2>
          {entries.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing has been posted yet. Entries are created at approval, payment or review (income).</p> : entries.map((e: any) => (
            <div key={e.id} className="mt-3 text-sm"><p className="font-medium">#{e.entry_no} · {e.d} · {e.memo} <span className="badge">{e.source_type}</span></p>
              <table className="mt-1 w-full"><tbody>{(e.lines ?? []).map((l: any, i: number) => <tr key={i} className="border-b border-line last:border-0"><td className="py-1">{l.code} {l.name}</td><td className="py-1 text-right tabular-nums">{Number(l.debit) > 0 ? Number(l.debit).toLocaleString(p.org.locale, { minimumFractionDigits: 2 }) : ''}</td><td className="py-1 text-right tabular-nums">{Number(l.credit) > 0 ? Number(l.credit).toLocaleString(p.org.locale, { minimumFractionDigits: 2 }) : ''}</td></tr>)}</tbody></table></div>))}</section>

        {p.allowed('finance:reverse') && ['approved', 'paid', 'posted', 'reconciled'].includes(t.status) && (
          <section className="card border-red-300" aria-label="Void"><h2 className="font-semibold">Void this transaction</h2><p className="text-sm text-muted">Posts reversing entries. Nothing is deleted. A reason is mandatory.</p>
            <ActionForm action={voidIt as any} submit="Void" tone="danger" className="mt-2" confirm="Void this transaction and reverse its ledger entries?"><input type="hidden" name="id" value={id} /><Field label="Reason" name="reason" required /></ActionForm></section>)}
      </div>
    );
  });
}
