import { page, mutate, field, optional } from '@/server/session';
import { createProfile, listMetrics, listProfiles, saveProfile } from '@/server/kpi';
import { listStructure } from '@/server/hr';
import { need } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';
import { LEVEL_BANDS } from '@/domain/kpi';
import { Notice } from '@/components/ui';

export const metadata = { title: 'KPI profiles' };
export const dynamic = 'force-dynamic';

async function create(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/kpi/profiles'], async (c) => { await createProfile(c, { departmentId: optional(f, 'dept'), levelBand: optional(f, 'band') }); return 'Profile created with the standard weights for that department and level. Adjust them below.'; });
}
async function save(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/kpi/profiles', '/kpi/team', '/kpi'], async (c) => {
    const items: { metricId: string; weight: number; target: number | null }[] = [];
    for (const [k, v] of f.entries()) {
      if (!k.startsWith('w:')) continue;
      const id = k.slice(2); const w = Number(String(v).replace(',', '.'));
      const t = String(f.get(`t:${id}`) ?? '').replace(/,/g, '').trim();
      if (w > 0) items.push({ metricId: id, weight: w, target: t ? Number(t) : null });
    }
    const add = field(f, 'newMetric'); const aw = Number(field(f, 'newWeight') || 0);
    if (add && aw > 0 && !items.some((x) => x.metricId === add)) items.push({ metricId: add, weight: aw, target: null });
    await saveProfile(c, field(f, 'id'), items, field(f, 'active') === 'on');
    return 'Profile saved. New results use these weights; finalised months are not changed.';
  });
}

export default async function Profiles() {
  return page(async (p) => {
    p.requireFeature('kpi');
    need(p.ctx, 'kpi:manage');
    const [profiles, metrics, st] = await Promise.all([listProfiles(p.ctx), listMetrics(p.ctx.q), listStructure(p.ctx.q)]);
    return (
      <div className="min-w-0 space-y-5">
        <h1 className="text-2xl font-bold">KPI profiles &amp; weights</h1>
        <Notice>Each person is scored with the most specific profile that matches their department and level: department + level, then department, then level, then the standard one. The weights of a profile must add up to exactly 100.</Notice>
        <section className="card"><h2 className="font-semibold">Add a profile</h2><ActionForm action={create as any} submit="Create profile" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-2">
          <Select label="Department (optional)" name="dept" options={st.departments.filter((d: any) => !d.archived_at).map((d: any) => ({ value: d.id, label: d.name }))} />
          <Select label="Level (optional)" name="band" options={LEVEL_BANDS.map((b) => ({ value: b.key, label: b.label }))} /></div></ActionForm></section>
        <ul className="space-y-3">{profiles.map((pr: any) => (
          <li key={pr.id} className={`card ${pr.active ? '' : 'opacity-60'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{pr.name}{!pr.active && <span className="badge ml-2">Off</span>}</p><span className="text-xs text-muted">{pr.metrics.length} measures · {Math.round(pr.metrics.reduce((a: number, m: any) => a + m.weight, 0) * 100) / 100}%</span></div>
            <details className="mt-2"><summary className="cursor-pointer text-sm font-medium underline">Edit weights</summary>
              <ActionForm action={save as any} submit="Save profile" className="mt-3"><input type="hidden" name="id" value={pr.id} />
                <div className="overflow-x-auto"><table className="w-full min-w-[28rem] text-sm"><thead><tr className="border-b border-line"><th className="th">Measure</th><th className="th">Weight %</th><th className="th">Monthly target</th></tr></thead>
                  <tbody>{pr.metrics.map((m: any) => <tr key={m.metricId} className="border-b border-line last:border-0"><td className="td">{m.name}<span className="block text-xs text-muted">{m.source === 'manual' ? 'rated by supervisor' : 'automatic'}</span></td>
                    <td className="td"><input name={`w:${m.metricId}`} defaultValue={String(m.weight)} inputMode="decimal" className="input !min-h-[38px] w-24" aria-label={`Weight for ${m.name}`} /></td>
                    <td className="td">{['sales_target', 'new_clients'].includes(m.source) ? <input name={`t:${m.metricId}`} defaultValue={m.target ?? ''} inputMode="decimal" className="input !min-h-[38px] w-32" aria-label={`Target for ${m.name}`} /> : <span className="text-muted">–</span>}</td></tr>)}</tbody></table></div>
                <p className="mt-2 text-xs text-muted">Set a weight to 0 to remove a measure.</p>
                <div className="mt-3 grid gap-x-4 sm:grid-cols-3"><Select label="Add a measure" name="newMetric" options={metrics.filter((m: any) => !pr.metrics.some((x: any) => x.metricId === m.id)).map((m: any) => ({ value: m.id, label: m.name }))} /><Field label="Its weight %" name="newWeight" /><label className="mt-7 flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={pr.active} className="h-5 w-5" /> Profile is in use</label></div>
              </ActionForm></details>
          </li>))}</ul>
      </div>
    );
  });
}
