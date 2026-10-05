import { page, mutate, field } from '@/server/session';
import { getTaxSettings, saveTaxSettings, taxPosition } from '@/server/invoices';
import { need } from '@/server/ctx';
import { ActionForm, Field } from '@/components/forms';
import { Money } from '@/components/money';
import { Notice, Stat } from '@/components/ui';

export const metadata = { title: 'Tax' };
export const dynamic = 'force-dynamic';

async function save(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/finance/tax'], async (c) => { await saveTaxSettings(c, Number(field(f, 'vat')), Number(field(f, 'wht'))); return 'Tax rates saved and recorded in the audit trail.'; });
}

export default async function Tax() {
  return page(async (p) => {
    p.requireFeature('finance');
    need(p.ctx, 'finance:view');
    const [s, pos] = await Promise.all([getTaxSettings(p.ctx.q), taxPosition(p.ctx)]);
    const k = { cur: p.org.currency, loc: p.org.locale };
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-bold">VAT &amp; withholding tax</h1>
        <Notice tone="warn">The rates below are defaults for you to confirm with a qualified accountant or the tax authority. WorkSuite records tax movements on the ledger; it does not file returns.</Notice>
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="VAT collected (output)" value={<Money v={pos.vatOutput} {...k} />} /><Stat label="VAT on purchases (input)" value={<Money v={pos.vatInput} {...k} />} /><Stat label="Net VAT to remit" value={<Money v={pos.vatNet} {...k} />} /><Stat label="WHT we owe / hold for us" value={<span className="text-base"><Money v={pos.whtPayable} {...k} /> / <Money v={pos.whtReceivable} {...k} /></span>} /></section>
        {p.allowed('finance:configure') && <section className="card"><h2 className="font-semibold">Rates</h2><ActionForm action={save as any} submit="Save rates" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-2"><Field label="VAT rate (%)" name="vat" defaultValue={String(s.vatRate)} required /><Field label="Default withholding tax rate (%)" name="wht" defaultValue={String(s.whtRate)} required hint="Used only to suggest an amount when recording receipts and payments." /></div></ActionForm></section>}
      </div>
    );
  });
}
