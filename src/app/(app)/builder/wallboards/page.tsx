import Link from 'next/link';
import { page, mutate, field } from '@/server/session';
import { createWallboard, listDashboards, listWallboards, revokeWallboard } from '@/server/dashboards';
import { need } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';
import { Empty, Notice, PageHead } from '@/components/ui';

export const metadata = { title: 'TV wallboards' };
export const dynamic = 'force-dynamic';

async function pair(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/builder/wallboards'], async (c) => {
    const token = await createWallboard(c, { name: field(f, 'name'), dashboardId: field(f, 'dashboardId'), refreshSeconds: Number(field(f, 'refresh')) || 60 });
    return `Screen paired. Open this address ONCE on the TV (it is shown only now): /wallboard/${token}`;
  });
}
async function revoke(_p: unknown, f: FormData) { 'use server'; return mutate(['/builder/wallboards'], async (c) => { await revokeWallboard(c, field(f, 'id')); return 'Screen disconnected.'; }); }

export default async function Wallboards() {
  return page(async (p) => {
    p.requireFeature('builders');
    need(p.ctx, 'wallboard:manage');
    const [boards, dashboards] = await Promise.all([listWallboards(p.ctx.q), listDashboards(p.ctx.q)]);
    return (
      <div className="space-y-5">
        <PageHead title="TV wallboards" sub="Show a dashboard on an office TV or large monitor. Screens are paired with a private link, are read-only, and never show finance, payroll or personal data."><Link className="btn-ghost" href="/builder">← Builder</Link></PageHead>
        <Notice>Open the link once on the TV&apos;s browser and leave it. It refreshes by itself. Disconnect a screen at any time and its link stops working immediately.</Notice>
        {boards.length === 0 ? <Empty title="No screens paired" /> : <ul className="space-y-2">{boards.map((b: any) => <li key={b.id} className="card flex flex-wrap items-center justify-between gap-2"><span><strong>{b.name}</strong> <span className="badge">{b.dashboard}</span> {!b.active && <span className="badge">disconnected</span>}<span className="block text-xs text-muted">Refreshes every {b.refresh_seconds}s · last seen {b.last_seen_at ? new Date(b.last_seen_at).toLocaleString(p.org.locale, { timeZone: p.org.timezone }) : 'never'}</span></span>{b.active && <ActionForm action={revoke as any} submit="Disconnect" tone="danger" className="!mt-0" confirm="Disconnect this screen?"><input type="hidden" name="id" value={b.id} /><span /></ActionForm>}</li>)}</ul>}
        <section className="card"><h2 className="font-semibold">Pair a new screen</h2>{dashboards.length === 0 ? <p className="mt-2 text-sm text-muted">Create a dashboard first.</p> :
          <ActionForm action={pair as any} submit="Pair screen" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-3"><Field label="Screen name" name="name" required placeholder="Newsroom TV" /><Select label="Dashboard" name="dashboardId" required allowEmpty={false} options={dashboards.map((d: any) => ({ value: d.id, label: d.name }))} /><Field label="Refresh every (seconds)" name="refresh" type="number" defaultValue="60" /></div></ActionForm>}</section>
      </div>
    );
  });
}
