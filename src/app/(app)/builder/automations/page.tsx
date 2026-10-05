import Link from 'next/link';
import { page, mutate, field } from '@/server/session';
import { listAutomations, listEntities, saveAutomation, toggleAutomation } from '@/server/builders';
import { need } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';
import { Empty, PageHead } from '@/components/ui';

export const metadata = { title: 'Automations' };
export const dynamic = 'force-dynamic';

async function create(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/builder/automations'], async (c) => {
    const conditions = [1, 2].map((n) => ({ field: field(f, `cf${n}`), op: field(f, `co${n}`) as any, value: field(f, `cv${n}`) })).filter((x) => x.field && x.value);
    const actions: any[] = [];
    if (field(f, 'role')) actions.push({ type: 'notify_role', role: field(f, 'role'), message: field(f, 'msg') });
    if (field(f, 'creator') === 'on') actions.push({ type: 'notify_creator', message: field(f, 'msg') });
    if (field(f, 'task')) actions.push({ type: 'create_task', title: field(f, 'task') });
    await saveAutomation(c, { entityKey: field(f, 'entity'), name: field(f, 'name'), trigger: field(f, 'trigger'), conditions, actions });
    return 'Rule saved and active.';
  });
}
async function toggle(_p: unknown, f: FormData) { 'use server'; return mutate(['/builder/automations'], async (c) => { await toggleAutomation(c, field(f, 'id'), field(f, 'active') === 'true'); return 'Updated.'; }); }

export default async function Automations() {
  return page(async (p) => {
    p.requireFeature('builders');
    need(p.ctx, 'builder:manage');
    const [rules, entities, roles] = await Promise.all([listAutomations(p.ctx.q), listEntities(p.ctx.q), p.ctx.q.query<any>(`select key, name from roles where not hidden order by name`)]);
    return (
      <div className="space-y-5">
        <PageHead title="Automations" sub="WHEN something happens, IF it matches, THEN notify someone or create a task. No code: just choices."><Link className="btn-ghost" href="/builder">← Builder</Link></PageHead>
        {rules.length === 0 ? <Empty title="No automations yet" text="Create one below, for example: when a purchase request is created and the estimate is at least 500000, notify the CEO." /> : <ul className="space-y-2">{rules.map((r: any) => (
          <li key={r.id} className="card flex flex-wrap items-center justify-between gap-2"><span><strong>{r.name}</strong> <span className="badge">{r.entity}</span> {!r.active && <span className="badge">off</span>}<span className="block text-xs text-muted">WHEN {r.trigger.replace('_', ' ')} {r.conditions.length ? 'IF ' + r.conditions.map((c: any) => `${c.field} ${c.op} ${c.value}`).join(' AND ') + ' ' : ''}THEN {r.actions.map((a: any) => a.type.replace('_', ' ') + (a.role ? ` (${a.role})` : '')).join(', ')}</span></span>
            <ActionForm action={toggle as any} submit={r.active ? 'Turn off' : 'Turn on'} tone="ghost" className="!mt-0"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="active" value={String(!r.active)} /><span /></ActionForm></li>))}</ul>}
        {entities.length > 0 && <section className="card" aria-labelledby="n"><h2 id="n" className="font-semibold">New rule</h2>
          <ActionForm action={create as any} submit="Save rule" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-3"><Field label="Name" name="name" required /><Select label="Module" name="entity" required allowEmpty={false} options={entities.map((e) => ({ value: e.key, label: e.name }))} /><Select label="When" name="trigger" allowEmpty={false} options={[{ value: 'record_created', label: 'A record is created' }, { value: 'status_changed', label: 'A record changes status' }]} /></div>
            <p className="mt-1 text-sm font-medium">Only if (optional)</p>{[1, 2].map((n) => <div key={n} className="mb-2 grid gap-2 sm:grid-cols-3"><input name={`cf${n}`} aria-label={`Condition ${n} field`} className="input" placeholder="field key (or _status)" /><select name={`co${n}`} aria-label={`Condition ${n} operator`} className="input" defaultValue="eq">{['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'in'].map((o) => <option key={o}>{o}</option>)}</select><input name={`cv${n}`} aria-label={`Condition ${n} value`} className="input" placeholder="value" /></div>)}
            <p className="mt-1 text-sm font-medium">Then</p><div className="grid gap-x-4 sm:grid-cols-2"><Select label="Notify everyone with role" name="role" options={roles.map((r: any) => ({ value: r.key, label: r.name }))} /><Field label="Message ({number}, {status}, {field_key} allowed)" name="msg" /><Field label="Create a task titled" name="task" /><label className="mt-7 flex items-center gap-2 text-sm"><input type="checkbox" name="creator" className="h-5 w-5" /> Notify the person who created the record</label></div></ActionForm></section>}
      </div>
    );
  });
}
