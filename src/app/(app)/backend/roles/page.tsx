import { page, mutate, field } from '@/server/session';
import { listRoles, saveRole } from '@/server/backend';
import { ALL_PERMISSIONS } from '@/domain/policy';
import { ActionForm, Field } from '@/components/forms';
import { Notice } from '@/components/ui';

export const metadata = { title: 'Roles · BackEnd' };
export const dynamic = 'force-dynamic';

async function save(_p: unknown, f: FormData) { 'use server'; return mutate(['/backend/roles'], async (c) => { await saveRole(c, { key: field(f, 'key'), name: field(f, 'name'), permissions: f.getAll('perm').map(String) }); return 'Role saved. People with this role get the change on their next page load.'; }); }

const groupOf = (p: string) => p.split(':')[0];

export default async function Roles() {
  return page(async (p) => {
    const roles = await listRoles(p.ctx);
    const groups = [...new Set(ALL_PERMISSIONS.map(groupOf))].sort();
    const Picker = ({ selected }: { selected: string[] }) => (
      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{groups.map((g) => <fieldset key={g} className="rounded-xl border border-line p-3"><legend className="px-1 text-xs font-semibold uppercase text-muted">{g}</legend>{ALL_PERMISSIONS.filter((x) => groupOf(x) === g && x !== 'backend:access').map((perm) => <label key={perm} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" name="perm" value={perm} defaultChecked={selected.includes(perm)} className="h-4 w-4" /> {perm.split(':').slice(1).join(':')}</label>)}</fieldset>)}</div>
    );
    return (
      <div className="space-y-5">
        <Notice tone="warn">Permissions decide who may see and do what, on the server. Be careful with finance and payroll permissions: they should stay with separate people (creator, reviewer, approver, payer).</Notice>
        {roles.map((r: any) => (
          <details key={r.id} className="card"><summary className="cursor-pointer"><span className="font-semibold">{r.name}</span> <span className="badge">{r.key}</span> <span className="text-sm text-muted">{r.members} member(s){r.hidden ? ' · hidden' : ''}</span></summary>
            {r.hidden ? <p className="mt-3 text-sm text-muted">Full authority. Cannot be edited or granted from here.</p> : (
              <ActionForm action={save as any} submit="Save role" className="mt-3"><input type="hidden" name="key" value={r.key} /><Field label="Name" name="name" required defaultValue={r.name} /><Picker selected={r.permissions} /></ActionForm>)}</details>))}
        <section className="card"><h2 className="font-semibold">Create a custom role</h2><ActionForm action={save as any} submit="Create role" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-2"><Field label="Key" name="key" required placeholder="e.g. trainer" /><Field label="Name" name="name" required /></div><Picker selected={['notification:view:own']} /></ActionForm></section>
      </div>
    );
  });
}
