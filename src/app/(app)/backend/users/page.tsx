import { page, mutate, field } from '@/server/session';
import { createUser, listRoles, listUsers, resetPassword, setUserRoles, setUserStatus } from '@/server/backend';
import { listStructure } from '@/server/hr';
import { ActionForm, Field, Select } from '@/components/forms';
import { Notice } from '@/components/ui';

export const metadata = { title: 'Users · BackEnd' };
export const dynamic = 'force-dynamic';

async function create(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/backend/users'], async (c) => { const r = await createUser(c, { email: field(f, 'email'), fullName: field(f, 'name'), roleKey: field(f, 'role'), departmentId: field(f, 'dept') || null, positionId: field(f, 'pos') || null }); return `Account created. One-time password (shown once, give it to the person securely; they must change it at first sign-in): ${r.password}`; });
}
async function reset(_p: unknown, f: FormData) { 'use server'; return mutate(['/backend/users'], async (c) => `New one-time password (shown once): ${await resetPassword(c, field(f, 'id'))}. All their sessions were signed out.`); }
async function status(_p: unknown, f: FormData) { 'use server'; const on = field(f, 'intent') === 'enable'; return mutate(['/backend/users'], async (c) => { await setUserStatus(c, field(f, 'id'), on, field(f, 'reason')); return on ? 'Account enabled.' : 'Account disabled and signed out.'; }); }
async function roles(_p: unknown, f: FormData) { 'use server'; return mutate(['/backend/users'], async (c) => { await setUserRoles(c, field(f, 'id'), f.getAll('roles').map(String)); return 'Roles updated.'; }); }

export default async function Users() {
  return page(async (p) => {
    const [users, rs, st] = await Promise.all([listUsers(p.ctx), listRoles(p.ctx), listStructure(p.ctx.q)]);
    const grantable = rs.filter((r: any) => !r.hidden);
    return (
      <div className="space-y-5">
        <section className="card" aria-labelledby="new"><h2 id="new" className="font-semibold">Create a user</h2>
          <ActionForm action={create as any} submit="Create account" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-3"><Field label="Full name" name="name" required /><Field label="Email" name="email" type="email" required />
            <Select label="Role" name="role" required allowEmpty={false} defaultValue="employee" options={grantable.map((r: any) => ({ value: r.key, label: r.name }))} />
            <Select label="Department" name="dept" options={st.departments.filter((d: any) => !d.archived_at).map((d: any) => ({ value: d.id, label: d.name }))} /><Select label="Position" name="pos" options={st.positions.filter((d: any) => !d.archived_at).map((d: any) => ({ value: d.id, label: d.name }))} /></div></ActionForm></section>
        <Notice>Passwords are never stored in readable form. A reset creates a new one-time password that must be changed at first sign-in.</Notice>
        <ul className="space-y-3">{users.map((u: any) => (
          <li key={u.id} className="card"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">{u.full_name ?? u.email} {u.hidden && <span className="badge">hidden account</span>}</p><p className="text-sm text-muted">{u.email}{u.department ? ` · ${u.department}` : ''}</p><p className="mt-1 flex flex-wrap gap-1">{(u.roles as string[]).map((r) => <span key={r} className="badge">{r}</span>)}<span className={`badge ${u.status === 'active' ? '' : 'bg-red-100 text-red-900'}`}>{u.status}</span>{u.mfa_enabled && <span className="badge bg-emerald-100 text-emerald-900">2-step on</span>}{u.must_change_password && <span className="badge bg-amber-100 text-amber-900">must change password</span>}</p></div></div>
            {!u.hidden && <details className="mt-3"><summary className="cursor-pointer text-sm underline">Manage</summary><div className="mt-3 grid gap-4 lg:grid-cols-3">
              <ActionForm action={roles as any} submit="Save roles" tone="ghost"><input type="hidden" name="id" value={u.id} /><fieldset><legend className="label">Roles</legend><div className="grid gap-1">{grantable.map((r: any) => <label key={r.key} className="flex items-center gap-2 text-sm"><input type="checkbox" name="roles" value={r.key} defaultChecked={(u.role_keys as string[]).includes(r.key)} className="h-5 w-5" /> {r.name}</label>)}</div></fieldset></ActionForm>
              <ActionForm action={reset as any} submit="Reset password" tone="ghost" confirm="Reset this person's password and sign them out?"><input type="hidden" name="id" value={u.id} /><p className="text-sm text-muted">Creates a new one-time password.</p></ActionForm>
              <ActionForm action={status as any} submit="Disable" className="" buttons={u.status === 'active' ? [{ label: 'Disable account', value: 'disable', tone: 'danger' }] : [{ label: 'Enable account', value: 'enable', tone: 'primary' }]}><input type="hidden" name="id" value={u.id} /><Field label="Reason (to disable)" name="reason" /></ActionForm></div></details>}</li>))}</ul>
      </div>
    );
  });
}
