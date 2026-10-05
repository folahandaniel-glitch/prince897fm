import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page, mutate, field } from '@/server/session';
import { addContact, createOpportunity, getAccount, logActivity, moveOpportunity, STAGE_LABEL, STAGES } from '@/server/crm';
import { Money } from '@/components/money';
import { ActionForm, Field, Select } from '@/components/forms';
import { PageHead } from '@/components/ui';

export const dynamic = 'force-dynamic';
const paths = (id: string) => [`/crm/${id}`, '/crm'];
async function contact(_p: unknown, f: FormData) { 'use server'; const id = field(f, 'id'); return mutate(paths(id), async (c) => { await addContact(c, id, { name: field(f, 'name'), title: field(f, 'title'), phone: field(f, 'phone'), email: field(f, 'email') }); return 'Contact added.'; }); }
async function activity(_p: unknown, f: FormData) { 'use server'; const id = field(f, 'id'); return mutate(paths(id), async (c) => { await logActivity(c, id, { kind: field(f, 'kind'), summary: field(f, 'summary'), followUpOn: field(f, 'followUp') || undefined, opportunityId: field(f, 'opp') || undefined }); return 'Logged.'; }); }
async function opp(_p: unknown, f: FormData) { 'use server'; const id = field(f, 'id'); return mutate(paths(id), async (c) => { await createOpportunity(c, id, { title: field(f, 'title'), value: field(f, 'value'), expectedClose: field(f, 'close') || undefined, campaignStart: field(f, 'cs') || undefined, campaignEnd: field(f, 'ce') || undefined }); return 'Opportunity added.'; }); }
async function move(_p: unknown, f: FormData) { 'use server'; const id = field(f, 'account'); return mutate(paths(id), async (c) => moveOpportunity(c, field(f, 'id'), field(f, 'stage'), field(f, 'reason'))); }

export default async function Account({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return page(async (p) => {
    p.requireFeature('crm');
    const d = await getAccount(p.ctx, id);
    if (!d) notFound();
    const { a, contacts, opps, acts, tickets } = d;
    const k = { cur: p.org.currency, loc: p.org.locale };
    const manage = p.allowed('crm:manage');
    return (
      <div className="space-y-5">
        <nav className="text-sm text-muted" aria-label="Breadcrumb"><Link className="underline" href="/crm">CRM</Link> / {a.name}</nav>
        <PageHead title={a.name} sub={[a.industry, a.phone, a.email].filter(Boolean).join(' · ')}><span className="badge text-sm">{a.status}</span>{a.fin_party_id && p.allowed('finance:create') && <Link className="btn-ghost" href="/finance/new">Record income</Link>}<Link className="btn-ghost" href="/tickets">Support</Link></PageHead>
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <section className="card" aria-labelledby="op"><h2 id="op" className="font-semibold">Opportunities</h2>
              {opps.length === 0 ? <p className="mt-2 text-sm text-muted">None yet.</p> : <ul className="mt-2 divide-y divide-line text-sm">{opps.map((o: any) => (
                <li key={o.id} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span><strong>{o.title}</strong> <span className="badge">{STAGE_LABEL[o.stage]}</span>{o.campaign_start && <span className="ml-2 text-xs text-muted">Campaign {String(o.campaign_start).slice(0, 10)} → {String(o.campaign_end ?? '').slice(0, 10)}</span>}</span><Money v={o.valueMinor} {...k} /></div>
                  {manage && !['won', 'lost'].includes(o.stage) && <ActionForm action={move as any} submit="Move" tone="ghost" className="mt-2"><input type="hidden" name="id" value={o.id} /><input type="hidden" name="account" value={id} /><div className="grid gap-x-3 sm:grid-cols-3"><Select label="Move to" name="stage" allowEmpty={false} options={STAGES.filter((s) => s !== o.stage).map((s) => ({ value: s, label: STAGE_LABEL[s] }))} /><Field label="Reason if lost" name="reason" /></div></ActionForm>}
                  {o.lost_reason && <p className="mt-1 text-xs text-muted">Lost: {o.lost_reason}</p>}</li>))}</ul>}
              {manage && <ActionForm action={opp as any} submit="Add opportunity" tone="ghost" className="mt-3 border-t border-line pt-3"><input type="hidden" name="id" value={id} /><div className="grid gap-x-4 sm:grid-cols-3"><Field label="Title" name="title" required placeholder="e.g. Q4 jingle package" /><Field label="Value (₦)" name="value" /><Field label="Expected close" name="close" type="date" /><Field label="Campaign starts" name="cs" type="date" /><Field label="Campaign ends" name="ce" type="date" /></div></ActionForm>}</section>

            <section className="card" aria-labelledby="ac"><h2 id="ac" className="font-semibold">Activity</h2>
              {manage && <ActionForm action={activity as any} submit="Log" className="mt-3"><input type="hidden" name="id" value={id} /><div className="grid gap-x-4 sm:grid-cols-3"><Select label="What" name="kind" allowEmpty={false} defaultValue="call" options={['call', 'meeting', 'email', 'sms', 'visit', 'note'].map((x) => ({ value: x, label: x }))} /><Field label="Follow up on" name="followUp" type="date" />{opps.length > 0 && <Select label="About opportunity" name="opp" options={opps.map((o: any) => ({ value: o.id, label: o.title }))} />}</div><div><label className="label" htmlFor="summary">Summary</label><textarea id="summary" name="summary" rows={2} required className="input py-2" /></div></ActionForm>}
              {acts.length === 0 ? <p className="mt-3 text-sm text-muted">No activity logged.</p> : <ul className="mt-3 space-y-3 text-sm">{acts.map((x: any) => <li key={x.id} className="border-l-2 border-brand pl-3"><p><strong className="capitalize">{x.kind}</strong> · {x.by_email} · {new Date(x.occurred_at).toLocaleDateString(p.org.locale)}</p><p>{x.summary}</p>{x.fu && <p className="text-xs text-muted">Follow-up {x.fu}{x.follow_up_done ? ' (done)' : ''}</p>}</li>)}</ul>}</section>
          </div>
          <aside className="space-y-5">
            <section className="card" aria-labelledby="ct"><h2 id="ct" className="font-semibold">Contacts</h2>
              <ul className="mt-2 divide-y divide-line text-sm">{contacts.map((c: any) => <li key={c.id} className="py-2"><p className="font-medium">{c.name}{c.is_primary ? ' ★' : ''}</p><p className="text-xs text-muted">{[c.title, c.phone, c.email].filter(Boolean).join(' · ')}</p></li>)}</ul>
              {manage && <ActionForm action={contact as any} submit="Add contact" tone="ghost" className="mt-3 border-t border-line pt-3"><input type="hidden" name="id" value={id} /><Field label="Name" name="name" required /><Field label="Role" name="title" /><Field label="Phone" name="phone" type="tel" /><Field label="Email" name="email" type="email" /></ActionForm>}</section>
            {tickets.length > 0 && <section className="card"><h2 className="font-semibold">Support tickets</h2><ul className="mt-2 text-sm">{tickets.map((t: any) => <li key={t.id}><Link className="underline" href={`/tickets/${t.id}`}>{t.number} · {t.subject}</Link> <span className="badge">{t.status}</span></li>)}</ul></section>}
            {a.notes && <section className="card"><h2 className="font-semibold">Notes</h2><p className="mt-1 whitespace-pre-wrap text-sm">{a.notes}</p></section>}
          </aside>
        </div>
      </div>
    );
  });
}
