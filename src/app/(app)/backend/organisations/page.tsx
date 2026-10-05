import { cookies } from 'next/headers';
import { page, field } from '@/server/session';
import { provisionOrganization } from '@/server/backend';
import { ORG_TEMPLATES } from '@/domain/templates';
import { resolveSession, SESSION_COOKIE } from '@/server/auth';
import { UserError } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';
import { Notice } from '@/components/ui';

export const metadata = { title: 'Organisations · BackEnd' };
export const dynamic = 'force-dynamic';

async function create(_p: unknown, f: FormData) {
  'use server';
  const s = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return { error: 'Please sign in again.' };
  try {
    const r = await provisionOrganization({ orgId: s.org_id, userId: s.user_id }, { slug: field(f, 'slug'), name: field(f, 'name'), templateKey: field(f, 'template'), adminEmail: field(f, 'email'), adminName: field(f, 'admin'), superAdminEmail: field(f, 'sa') || undefined });
    return { ok: `Organisation "${r.slug}" created. Administrator one-time password (shown once): ${r.adminPassword}${r.superAdminPassword ? `. Support Super Admin one-time password: ${r.superAdminPassword}` : ''}. They must change it at first sign-in. Sign-in code: ${r.slug}` };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    console.error(e);
    return { error: 'Could not create the organisation. Nothing was shared.' };
  }
}

export default async function Orgs() {
  return page(async (p) => {
    const orgs = p.platformAdmin ? await p.ctx.q.query<any>(`select slug, name, template, status, created_at, (select count(*)::int from users u where u.org_id = o.id) as users from organizations o order by created_at`) : [];
    return (
      <div className="space-y-5">
        {!p.platformAdmin ? <Notice tone="warn">Only platform operators can create organisations.</Notice> : (<>
          <section className="card"><h2 className="font-semibold">Create an organisation from a template</h2><p className="mt-1 text-sm text-muted">Departments, positions, terminology, leave types, finance accounts, ticket categories and module packs are set up for you. Everything can be changed afterwards.</p>
            <ActionForm action={create as any} submit="Create organisation" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-3"><Field label="Name" name="name" required /><Field label="Sign-in code" name="slug" required placeholder="e.g. st-marys-school" hint="Lowercase letters, numbers, dashes." />
              <Select label="Template" name="template" required allowEmpty={false} defaultValue="blank" options={ORG_TEMPLATES.map((t) => ({ value: t.key, label: `${t.label}: ${t.description}` }))} /><Field label="Administrator's name" name="admin" /><Field label="Administrator's email" name="email" type="email" required /><Field label="Support Super Admin email (optional)" name="sa" type="email" hint="A hidden support account for you." /></div></ActionForm></section>
          <section className="card overflow-x-auto"><h2 className="font-semibold">Organisations on this platform</h2><table className="mt-2 w-full min-w-[30rem]"><thead><tr className="border-b border-line"><th className="th">Name</th><th className="th">Code</th><th className="th">Template</th><th className="th">Users</th><th className="th">Status</th></tr></thead><tbody>{orgs.map((o: any) => <tr key={o.slug} className="border-b border-line last:border-0"><td className="td font-medium">{o.name}</td><td className="td">{o.slug}</td><td className="td">{o.template}</td><td className="td">{o.users}</td><td className="td"><span className="badge">{o.status}</span></td></tr>)}</tbody></table></section></>)}
      </div>
    );
  });
}
