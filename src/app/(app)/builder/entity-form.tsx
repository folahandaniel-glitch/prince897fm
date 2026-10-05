import { slug, FIELD_TYPES, type FieldType } from '@/domain/builders';
import { saveEntity, type Entity, type EntityInput } from '@/server/builders';
import { mutate, field } from '@/server/session';
import { ActionForm, Field } from '@/components/forms';

const FIELD_ROWS = 14, STATUS_ROWS = 8, FLOW_ROWS = 10;

export async function saveEntityAction(_p: unknown, f: FormData) {
  'use server';
  const key = field(f, 'key');
  return mutate(['/builder', `/builder/${key}`], async (c) => {
    const fields: EntityInput['fields'] = [];
    for (let i = 1; i <= FIELD_ROWS; i++) {
      const label = field(f, `fl${i}`);
      if (!label) continue;
      const opts = field(f, `fo${i}`).split(',').map((x) => x.trim()).filter(Boolean);
      fields.push({ key: field(f, `fk${i}`) || slug(label), label, type: (field(f, `ft${i}`) || 'text') as FieldType, required: field(f, `fr${i}`) === 'on', options: opts.length ? opts : undefined, showInList: true, searchable: true });
    }
    const statuses: EntityInput['statuses'] = [];
    for (let i = 1; i <= STATUS_ROWS; i++) { const label = field(f, `sl${i}`); if (label) statuses.push({ key: field(f, `sk${i}`) || slug(label), label }); }
    const flowSteps: EntityInput['transitions'] = [];
    for (let i = 1; i <= FLOW_ROWS; i++) { const from = field(f, `tf${i}`), to = field(f, `tt${i}`); if (from && to) flowSteps.push({ from, to, roles: field(f, `tr${i}`).split(',').map((x) => x.trim()).filter(Boolean) }); }
    const list = (k: string) => field(f, k).split(',').map((x) => x.trim()).filter(Boolean);
    await saveEntity(c, { key, name: field(f, 'name'), plural: field(f, 'plural'), description: field(f, 'description'), prefix: field(f, 'prefix').toUpperCase(), fields, statuses, transitions: flowSteps, access: { view: list('av'), create: list('ac'), edit: list('ae'), remove: list('ar') }, navGroup: field(f, 'group') || 'Modules', publicSlug: field(f, 'pub') || null, publicNotifyRole: field(f, 'pubrole') || null });
    return 'Saved. The module is available from the menu straight away.';
  });
}

export function EntityForm({ e, isNew }: { e?: Entity; isNew: boolean }) {
  const fields = (e?.fields ?? []).filter((x) => !x.archived);
  const statuses = e?.statuses ?? [{ key: 'new', label: 'New' }, { key: 'done', label: 'Done' }];
  const flowRows = e?.transitions ?? [{ from: 'new', to: 'done', roles: [] }];
  const access = e?.access ?? { view: ['*'], create: ['*'], edit: ['tenant_admin'], remove: ['tenant_admin'] };
  return (
    <ActionForm action={saveEntityAction as any} submit="Save module">
      <div className="grid gap-x-4 sm:grid-cols-3">
        {isNew ? <Field label="Key (short, lowercase)" name="key" required placeholder="e.g. pastoral_care" hint="Cannot be changed later." /> : <input type="hidden" name="key" value={e!.key} />}
        <Field label="Name" name="name" required defaultValue={e?.name} /><Field label="Plural name (menu)" name="plural" defaultValue={e?.plural} />
        <Field label="Record prefix (2-5 capitals)" name="prefix" required defaultValue={e?.prefix} placeholder="PCV" /><Field label="Menu group" name="group" defaultValue={e?.navGroup ?? 'Modules'} /><Field label="Description" name="description" defaultValue={e?.description} />
      </div>

      <fieldset className="mt-3"><legend className="label">Fields (leave unused rows blank; clearing a field archives it and keeps old data)</legend>
        <div className="hidden gap-2 text-xs font-semibold text-muted sm:grid sm:grid-cols-[1fr_9rem_6rem_1fr]"><span>Label</span><span>Type</span><span>Required</span><span>Options (comma separated, for lists)</span></div>
        {Array.from({ length: FIELD_ROWS }, (_, i) => { const x = fields[i]; return (
          <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1fr_9rem_6rem_1fr]"><input type="hidden" name={`fk${i + 1}`} value={x?.key ?? ''} />
            <input name={`fl${i + 1}`} aria-label={`Field ${i + 1} label`} defaultValue={x?.label} className="input" placeholder={`Field ${i + 1}`} />
            <select name={`ft${i + 1}`} aria-label={`Field ${i + 1} type`} defaultValue={x?.type ?? 'text'} className="input">{FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={`fr${i + 1}`} defaultChecked={x?.required} className="h-5 w-5" /> Required</label>
            <input name={`fo${i + 1}`} aria-label={`Field ${i + 1} options`} defaultValue={x?.options?.join(', ')} className="input" placeholder="Option A, Option B" /></div>); })}</fieldset>

      <fieldset className="mt-3"><legend className="label">Statuses (the first one is where new records start)</legend>
        <div className="grid gap-2 sm:grid-cols-4">{Array.from({ length: STATUS_ROWS }, (_, i) => <div key={i}><input type="hidden" name={`sk${i + 1}`} value={statuses[i]?.key ?? ''} /><input name={`sl${i + 1}`} aria-label={`Status ${i + 1}`} defaultValue={statuses[i]?.label} className="input" placeholder={`Status ${i + 1}`} /></div>)}</div></fieldset>

      <fieldset className="mt-3"><legend className="label">Workflow: allowed moves between statuses (use status keys; roles optional)</legend>
        <p className="mb-1 text-xs text-muted">Status keys: {statuses.map((s) => s.key).join(', ') || 'save once to see them'}. Roles: comma-separated role keys such as <code>department_head, ceo</code>. Blank = anyone who can view the record.</p>
        {Array.from({ length: FLOW_ROWS }, (_, i) => { const t = flowRows[i]; return <div key={i} className="mb-2 grid gap-2 sm:grid-cols-3"><input name={`tf${i + 1}`} aria-label={`Move ${i + 1} from`} defaultValue={t?.from} className="input" placeholder="from status key" /><input name={`tt${i + 1}`} aria-label={`Move ${i + 1} to`} defaultValue={t?.to} className="input" placeholder="to status key" /><input name={`tr${i + 1}`} aria-label={`Move ${i + 1} roles`} defaultValue={t?.roles.join(', ')} className="input" placeholder="roles allowed (optional)" /></div>; })}</fieldset>

      <fieldset className="mt-3"><legend className="label">Who can do what (role keys, comma separated; * = every signed-in staff member)</legend>
        <div className="grid gap-x-4 sm:grid-cols-2"><Field label="View" name="av" defaultValue={access.view.join(', ')} /><Field label="Create" name="ac" defaultValue={access.create.join(', ')} /><Field label="Edit" name="ae" defaultValue={access.edit.join(', ')} /><Field label="Archive" name="ar" defaultValue={access.remove.join(', ')} /></div></fieldset>

      <fieldset className="mt-3"><legend className="label">Public form (optional)</legend>
        <div className="grid gap-x-4 sm:grid-cols-2"><Field label="Web address name" name="pub" defaultValue={e?.publicSlug ?? ''} hint="Turns on /f/your-org/<name>. Anyone can submit. Leave blank to keep it private." /><Field label="Role notified of new submissions" name="pubrole" defaultValue={e?.publicNotifyRole ?? ''} /></div></fieldset>
    </ActionForm>
  );
}
