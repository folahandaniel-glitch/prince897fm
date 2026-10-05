import Link from 'next/link';
import { page, mutate, field } from '@/server/session';
import { listEntities } from '@/server/builders';
import { listDashboards, METRICS, saveDashboard, type Widget } from '@/server/dashboards';
import { need } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';
import { Empty, PageHead } from '@/components/ui';

export const metadata = { title: 'Dashboards' };
export const dynamic = 'force-dynamic';
const ROWS = 8;

async function save(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/builder/dashboards'], async (c) => {
    const widgets: Widget[] = [];
    for (let i = 1; i <= ROWS; i++) {
      const kind = field(f, `k${i}`);
      if (!kind) continue;
      const [type, ref] = kind.split(':');
      const title = field(f, `t${i}`) || ref;
      if (type === 'metric') widgets.push({ id: `w${i}`, type: 'metric', title, metric: ref });
      else if (type === 'entity_count') widgets.push({ id: `w${i}`, type: 'entity_count', title, entity: ref });
      else if (type === 'entity_list') widgets.push({ id: `w${i}`, type: 'entity_list', title, entity: ref });
      else if (type === 'text') widgets.push({ id: `w${i}`, type: 'text', title, text: field(f, `x${i}`) });
    }
    const slug = await saveDashboard(c, { slug: field(f, 'slug'), name: field(f, 'name'), device: field(f, 'device'), widgets, roles: field(f, 'who') === 'managers' ? ['hr_manager', 'department_head', 'executive', 'ceo', 'tenant_admin', 'finance_manager'] : ['*'] });
    return `Saved. Open it at /d/${slug}.`;
  });
}

export default async function Dashboards() {
  return page(async (p) => {
    p.requireFeature('builders');
    need(p.ctx, 'builder:manage');
    const [ds, entities] = await Promise.all([listDashboards(p.ctx.q), listEntities(p.ctx.q)]);
    const options = [{ value: '', label: '— none —' }, ...METRICS.map((m) => ({ value: `metric:${m.key}`, label: `Figure: ${m.label}${m.tvSafe ? '' : ' (not on TVs)'}` })), ...entities.flatMap((e) => [{ value: `entity_count:${e.key}`, label: `Count of ${e.plural}` }, { value: `entity_list:${e.key}`, label: `Latest ${e.plural}` }]), { value: 'text', label: 'Text note' }];
    return (
      <div className="space-y-5">
        <PageHead title="Dashboards" sub="Combine figures, counts and lists into a page for a role or a screen. Figures a viewer is not allowed to see are left out automatically."><Link className="btn-ghost" href="/builder">← Builder</Link></PageHead>
        {ds.length === 0 ? <Empty title="No dashboards yet" /> : <ul className="grid gap-3 sm:grid-cols-2">{ds.map((d: any) => <li key={d.id} className="card"><p className="font-semibold">{d.name}</p><p className="text-xs text-muted">{(d.widgets as any[]).length} widgets · {d.device}</p><Link className="btn-ghost mt-2" href={`/d/${d.slug}`}>Open</Link></li>)}</ul>}
        <section className="card" aria-labelledby="n"><h2 id="n" className="font-semibold">Create or update a dashboard</h2>
          <ActionForm action={save as any} submit="Save dashboard" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-4"><Field label="Name" name="name" required /><Field label="Web address name" name="slug" hint="Updates the dashboard with the same name." /><Select label="Best on" name="device" allowEmpty={false} defaultValue="any" options={[{ value: 'any', label: 'Any device' }, { value: 'desktop', label: 'Desktop' }, { value: 'mobile', label: 'Phone' }, { value: 'tv', label: 'TV screen' }]} /><Select label="Who can open it" name="who" allowEmpty={false} defaultValue="all" options={[{ value: 'all', label: 'All staff' }, { value: 'managers', label: 'Managers only' }]} /></div>
            {Array.from({ length: ROWS }, (_, i) => <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr]"><select name={`k${i + 1}`} aria-label={`Widget ${i + 1}`} className="input" defaultValue="">{options.map((o) => <option key={o.value + o.label} value={o.value}>{o.label}</option>)}</select><input name={`t${i + 1}`} aria-label={`Widget ${i + 1} title`} className="input" placeholder="Title" /><input name={`x${i + 1}`} aria-label={`Widget ${i + 1} text`} className="input" placeholder="Text (for notes)" /></div>)}
          </ActionForm></section>
      </div>
    );
  });
}
