import { notFound } from 'next/navigation';
import { privileged, withTenant } from '@/server/db';
import { boot, field, optional } from '@/server/session';
import { resolveConfig } from '@/server/config';
import { listStructure, submitRegistration } from '@/server/hr';
import { UserError } from '@/server/ctx';
import { term, hexToRgbTriplet } from '@/domain/config-schema';
import { ActionForm, Field, Select } from '@/components/forms';

export const metadata = { title: 'Register' };

async function register(_p: unknown, f: FormData) {
  'use server';
  await boot();
  try {
    await submitRegistration({
      orgSlug: field(f, 'org'), fullName: field(f, 'fullName'), email: field(f, 'email'), phone: optional(f, 'phone') ?? undefined, password: field(f, 'password'),
      departmentId: optional(f, 'departmentId') ?? undefined, branchId: optional(f, 'branchId') ?? undefined, positionId: optional(f, 'positionId') ?? undefined,
    });
    return { ok: 'Registration submitted. You can sign in once an administrator approves it. Your requested role does not give you access by itself.' };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    console.error(e);
    return { error: 'Could not submit your registration. Please try again.' };
  }
}

export default async function RegisterPage({ params }: { params: Promise<{ org: string }> }) {
  await boot();
  const { org: slug } = await params;
  const org = (await (await privileged()).query<any>(`select id, name from organizations where slug = $1 and status = 'active'`, [slug]))[0];
  if (!org) notFound();
  const { cfg, st } = await withTenant(org.id, async (q) => ({ cfg: await resolveConfig(q), st: await listStructure(q) }));
  const t = (k: string) => term(cfg.terms, k);
  return (
    <main id="main" className="grid min-h-screen place-items-center p-4" style={{ ['--brand' as string]: hexToRgbTriplet(cfg.branding.primary) }}>
      <div className="card w-full max-w-lg">
        {cfg.branding.logoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <div className="mb-4 flex justify-center rounded-xl bg-[#0b0b0b] px-4 py-3"><img src={cfg.branding.logoUrl} alt={org.name} width={400} height={110} decoding="async" className="h-auto w-44 max-w-full" /></div> : null}
        <h1 className="text-2xl font-bold">Join {org.name}</h1>
        <p className="mt-1 text-sm text-muted">Tell us where you expect to work. These are requests only; your actual {t('position').toLowerCase()}, {t('department').toLowerCase()} and access are set by an administrator.</p>
        <ActionForm action={register as any} submit="Submit registration" className="mt-5">
          <input type="hidden" name="org" value={slug} />
          <Field label="Full name" name="fullName" required autoComplete="name" />
          <Field label="Email" name="email" type="email" required autoComplete="email" />
          <Field label="Phone" name="phone" type="tel" autoComplete="tel" />
          <Field label="Password" name="password" type="password" required autoComplete="new-password" hint="At least 12 characters. A passphrase of unrelated words works well." />
          <Select label={`Requested ${t('department').toLowerCase()}`} name="departmentId" options={st.departments.filter((d: any) => !d.archived_at).map((d: any) => ({ value: d.id, label: d.name }))} />
          <Select label={`Requested ${t('branch').toLowerCase()}`} name="branchId" options={st.branches.filter((d: any) => !d.archived_at).map((d: any) => ({ value: d.id, label: d.name }))} />
          <Select label={`Requested ${t('position').toLowerCase()}`} name="positionId" options={st.positions.filter((d: any) => !d.archived_at).map((d: any) => ({ value: d.id, label: d.name }))} />
        </ActionForm>
      </div>
    </main>
  );
}
