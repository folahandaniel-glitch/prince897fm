import { notFound } from 'next/navigation';
import { page, mutate, field } from '@/server/session';
import { getContract, setContractStatus } from '@/server/contracts';
import { ActionForm, Field } from '@/components/forms';
import { PrintButton } from '@/components/print-button';
import { PageHead } from '@/components/ui';

export const dynamic = 'force-dynamic';

async function act(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/contracts'], async (c) => { await setContractStatus(c, field(f, 'id'), field(f, 'intent') as 'send' | 'sign' | 'cancel', { signedBy: field(f, 'signedBy'), signedOn: field(f, 'signedOn') }); return 'Updated.'; });
}

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return page(async (p) => {
    const k = await getContract(p.ctx, id);
    if (!k) notFound();
    const manage = p.allowed('contract:manage');
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHead title={`${k.number}: ${k.title}`} sub={`${k.client} · ${k.status}${k.signed_s ? ` · signed ${k.signed_s} by ${k.signed_by_name}` : ''}`}><PrintButton /></PageHead>
        <article className="card whitespace-pre-wrap text-sm leading-relaxed print:border-0 print:shadow-none">{k.body}</article>
        {manage && ['draft', 'sent'].includes(k.status) && <section className="card no-print"><ActionForm action={act as any} submit="Mark as signed" className="" buttons={[...(k.status === 'draft' ? [{ label: 'Mark as sent', value: 'send', tone: 'ghost' as const }] : []), { label: 'Mark as signed', value: 'sign' }, { label: 'Cancel contract', value: 'cancel', tone: 'danger' }]}>
          <input type="hidden" name="id" value={k.id} /><div className="grid gap-x-4 sm:grid-cols-2"><Field label="Signed by (client)" name="signedBy" /><Field label="Date signed" name="signedOn" type="date" /></div></ActionForm></section>}
      </div>
    );
  });
}
