import { page, mutate, field } from '@/server/session';
import { listTemplates, saveTemplate, setTemplateActive } from '@/server/reports';
import { need } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';

export const metadata = { title: 'Report templates' };
export const dynamic = 'force-dynamic';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function create(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/admin/reports', '/reports'], async (c) => {
    const fields = [1, 2, 3, 4, 5, 6].map((n) => ({ label: field(f, `q${n}`), type: field(f, `t${n}`) || 'longtext', required: field(f, `r${n}`) === 'on' }));
    const chain = [field(f, 'step1'), field(f, 'step2'), field(f, 'step3')].filter(Boolean).map((s) => (s === 'supervisor' ? { kind: 'supervisor' as const } : { kind: 'role' as const, roleKey: s }));
    await saveTemplate(c, { name: field(f, 'name'), cadence: field(f, 'cadence') as any, dueWeekday: Number(field(f, 'weekday')) || 5, dueTime: field(f, 'dueTime') || '18:00', fields, chain });
    return 'Template created. It applies from the current period.';
  });
}
async function toggle(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/admin/reports'], async (c) => { await setTemplateActive(c, field(f, 'id'), field(f, 'active') === 'true'); return 'Updated.'; });
}

export default async function ReportSetup() {
  return page(async (p) => {
    need(p.ctx, 'report:manage');
    const [templates, roles] = await Promise.all([listTemplates(p.ctx.q), p.ctx.q.query<any>('select key, name from roles order by name')]);
    const stepOptions = [{ value: 'supervisor', label: 'Direct supervisor' }, ...roles.map((r: any) => ({ value: r.key, label: `Role: ${r.name}` }))];
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Report templates</h1>
        <p className="text-sm text-muted">Define what staff report, when it is due and who approves it. The first stage is usually the direct supervisor.</p>
        <section className="card" aria-labelledby="t"><h2 id="t" className="font-semibold">Templates</h2>
          <ul className="mt-2 divide-y divide-line text-sm">{templates.map((t: any) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><strong>{t.name}</strong> <span className="badge">{t.cadence}</span> {!t.active && <span className="badge">disabled</span>}
                <span className="block text-muted">Due {t.cadence === 'weekly' ? DAYS[t.due_weekday ?? 5] : 'last day of the month'} at {String(t.due_time).slice(0, 5)} · {(t.fields as any[]).length} questions · approvals: {(t.chain as any[]).map((s) => (s.kind === 'supervisor' ? 'Supervisor' : roles.find((r: any) => r.key === s.roleKey)?.name ?? s.roleKey)).join(' → ') || 'none'}</span></span>
              <ActionForm action={toggle as any} submit={t.active ? 'Disable' : 'Enable'} tone="ghost" className="!mt-0"><input type="hidden" name="id" value={t.id} /><input type="hidden" name="active" value={String(!t.active)} /><span /></ActionForm></li>))}</ul></section>

        <section className="card" aria-labelledby="n"><h2 id="n" className="font-semibold">New template</h2>
          <ActionForm action={create as any} submit="Create template" className="mt-3">
            <div className="grid gap-x-4 sm:grid-cols-4">
              <Field label="Name" name="name" required />
              <Select label="Cadence" name="cadence" allowEmpty={false} defaultValue="weekly" options={[{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly (last day)' }]} />
              <Select label="Weekly deadline day" name="weekday" allowEmpty={false} defaultValue="5" options={DAYS.map((d, i) => ({ value: String(i), label: d }))} />
              <Field label="Deadline time" name="dueTime" type="time" defaultValue="18:00" /></div>
            <fieldset className="mt-2"><legend className="label">Questions (leave unused rows blank)</legend>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <div key={n} className="mb-2 grid gap-2 sm:grid-cols-[1fr_9rem_6rem]"><input name={`q${n}`} aria-label={`Question ${n}`} className="input" placeholder={`Question ${n}`} />
                  <select name={`t${n}`} aria-label={`Answer type ${n}`} className="input" defaultValue="longtext"><option value="longtext">Long text</option><option value="text">Short text</option><option value="number">Number</option></select>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={`r${n}`} defaultChecked className="h-5 w-5" /> Required</label></div>))}</fieldset>
            <fieldset className="mt-2"><legend className="label">Approval chain, in order</legend>
              <div className="grid gap-x-4 sm:grid-cols-3">{[1, 2, 3].map((n) => <Select key={n} label={`Stage ${n}`} name={`step${n}`} defaultValue={n === 1 ? 'supervisor' : n === 2 ? 'executive' : ''} options={stepOptions} />)}</div></fieldset>
          </ActionForm></section>
      </div>
    );
  });
}
