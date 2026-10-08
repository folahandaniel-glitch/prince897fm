import Link from 'next/link';
import { page, mutate, field } from '@/server/session';
import { accountSummary, KIND_LABEL, KINDS, moderate, recentActivity, type Kind } from '@/server/oversight';
import { need } from '@/server/ctx';
import { ActionForm, Field } from '@/components/forms';
import { Empty, Notice } from '@/components/ui';

export const metadata = { title: 'Oversight' };
export const dynamic = 'force-dynamic';

async function remove(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/admin/oversight'], async (c) => { await moderate(c, field(f, 'kind'), field(f, 'id'), field(f, 'reason')); return 'Removed. The reason is recorded in the audit trail.'; });
}

export default async function Oversight({ searchParams }: { searchParams: Promise<{ kind?: string; user?: string; q?: string; days?: string }> }) {
  const sp = await searchParams;
  return page(async (p) => {
    need(p.ctx, 'admin:control');
    const userId = sp.user && /^[0-9a-f-]{36}$/i.test(sp.user) ? sp.user : undefined;
    const [items, accounts] = await Promise.all([recentActivity(p.ctx, { kind: sp.kind, userId, q: sp.q, days: Number(sp.days) || 30, limit: 100 }), accountSummary(p.ctx)]);
    const when = (iso: string) => new Date(iso).toLocaleString(p.org.locale, { timeZone: p.org.timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const total = (a: any) => a.tasks + a.documents + a.tickets + a.clients + a.announcements + a.records;
    return (
      <div className="min-w-0 space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold">Oversight</h1><p className="text-sm text-muted">What staff are creating on the front end, across every account. Remove anything that should not be there; every removal needs a reason and is audited.</p></div>
          <div className="flex gap-2"><Link className="btn-ghost" href="/admin/accounts">Manage accounts</Link><Link className="btn-ghost" href="/admin/audit">Audit trail</Link></div></header>
        <Notice>Private channels (internal mail, payslips, discipline files) are not shown here.</Notice>
        <form className="card flex flex-wrap items-end gap-3" role="search">
          <div><label className="label" htmlFor="kind">Type</label><select id="kind" name="kind" defaultValue={sp.kind ?? ''} className="input"><option value="">All</option>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></div>
          <div><label className="label" htmlFor="user">Created by</label><select id="user" name="user" defaultValue={userId ?? ''} className="input"><option value="">Anyone</option>{accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          <div><label className="label" htmlFor="days">Period</label><select id="days" name="days" defaultValue={sp.days ?? '30'} className="input"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option></select></div>
          <div className="min-w-[10rem] flex-1"><label className="label" htmlFor="q">Search title</label><input id="q" name="q" defaultValue={sp.q ?? ''} className="input" /></div><button className="btn-primary">Filter</button></form>
        <section className="min-w-0" aria-label="Recent items">{items.length === 0 ? <Empty title="Nothing found" text="Try a longer period or a different filter." /> : (
          <ul className="space-y-2">{items.map((it) => (
            <li key={`${it.kind}-${it.id}`} className="card !p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-medium"><span className="badge mr-2">{KIND_LABEL[it.kind as Kind]}</span><Link className="underline" href={it.href}>{it.title}</Link></p><p className="text-xs text-muted">{it.byName ?? 'Public form / system'} · {when(it.at)}{it.status ? ` · ${it.status}` : ''}</p></div>
              {it.removable && <details className="text-right"><summary className="cursor-pointer text-xs text-muted underline">Remove</summary><ActionForm action={remove as any} submit="Remove" tone="danger" confirm="Remove this item?" className="mt-2 w-64 text-left"><input type="hidden" name="kind" value={it.kind} /><input type="hidden" name="id" value={it.id} /><Field label="Reason" name="reason" required /></ActionForm></details>}</div></li>))}</ul>)}</section>
        <section className="card overflow-x-auto p-0"><h2 className="px-4 pt-4 font-semibold">Who is creating what</h2><table className="mt-2 w-full min-w-[36rem]"><thead><tr className="border-b border-line"><th className="th">Account</th><th className="th text-right">Tasks</th><th className="th text-right">Documents</th><th className="th text-right">Tickets</th><th className="th text-right">Clients</th><th className="th text-right">Records</th><th className="th text-right">Total</th></tr></thead>
          <tbody>{accounts.map((a: any) => <tr key={a.id} className="border-b border-line last:border-0"><td className="td"><Link className="underline" href={`/admin/oversight?user=${a.id}`}>{a.name}</Link>{a.status !== 'active' && <span className="badge ml-2">{a.status}</span>}</td><td className="td text-right tabular-nums">{a.tasks}</td><td className="td text-right tabular-nums">{a.documents}</td><td className="td text-right tabular-nums">{a.tickets}</td><td className="td text-right tabular-nums">{a.clients}</td><td className="td text-right tabular-nums">{a.records}</td><td className="td text-right font-semibold tabular-nums">{total(a)}</td></tr>)}</tbody></table></section>
      </div>
    );
  });
}
