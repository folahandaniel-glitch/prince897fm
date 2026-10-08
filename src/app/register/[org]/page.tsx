import { notFound } from 'next/navigation';
import { privileged, withTenant } from '@/server/db';
import { boot, field, optional } from '@/server/session';
import { resolveConfig } from '@/server/config';
import { listStructure, submitRegistration } from '@/server/hr';
import { UserError } from '@/server/ctx';
import { term, hexToRgbTriplet } from '@/domain/config-schema';
import { AuthScene } from '@/app/login/scene';
import { ActionForm, Field, Select } from '@/components/forms';

export const metadata = { title: 'Register' };

async function register(_p: unknown, f: FormData) {
  'use server';
  await boot();
  try {
    await submitRegistration({
      orgSlug: field(f, 'org'), fullName: field(f, 'fullName'), email: field(f, 'email'), phone: field(f, 'phone'), password: field(f, 'password'), username: field(f, 'username'), birthDate: field(f, 'birth'), employmentType: field(f, 'type'),
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
    <main id="main" className="grid min-h-screen bg-[#0b0b0b] lg:grid-cols-[1fr_1.05fr]" style={{ ['--brand' as string]: hexToRgbTriplet(cfg.branding.primary), ['--accent' as string]: hexToRgbTriplet(cfg.branding.accent), ['--brand-2' as string]: hexToRgbTriplet(cfg.branding.secondary) }}>
      <section className="auth-hero flex flex-col justify-between px-6 py-8 text-white sm:px-10 lg:sticky lg:top-0 lg:h-screen lg:px-14 lg:py-12" aria-label={org.name}>
        <div className="auth-orb a" aria-hidden /><div className="auth-orb b" aria-hidden />
        <div className="relative z-10 flex items-center justify-between gap-4">
          {cfg.branding.logoUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={cfg.branding.logoUrl} alt={org.name} width={400} height={110} fetchPriority="high" className="h-auto w-44 max-w-full sm:w-56" /> : <p className="text-2xl font-bold">{org.name}</p>}
          <span className="auth-eq" aria-hidden><i /><i /><i /><i /><i /></span>
        </div>
        <div className="relative z-10 my-4 lg:my-2"><AuthScene photo="/brand/chairman.webp" /></div>
        <div className="relative z-10 max-w-xl">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-white/70">You are about to go live</p>
          <h1 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">Join the {org.name} family<span className="text-[rgb(var(--accent))]">.</span></h1>
          <p className="mt-3 max-w-md text-base text-white/80">{cfg.branding.tagline || 'Register once. Once approved, your attendance, tasks, pay and growth live in one place.'}</p>
        </div>
      </section>
      <section className="flex items-start justify-center bg-[#0b0b0b] px-4 py-8 sm:px-8 lg:items-center lg:py-12">
        <div className="card w-full max-w-lg !border-white/10 shadow-2xl">
          <h2 className="text-2xl font-bold">Create your staff account</h2>
          <p className="mt-1 text-sm text-muted">Every detail is required. Your {t('position').toLowerCase()}, {t('department').toLowerCase()} and access are confirmed by an administrator.</p>
        <ActionForm action={register as any} submit="Submit registration" className="mt-5">
          <input type="hidden" name="org" value={slug} />
          <Field label="Full name" name="fullName" required autoComplete="name" />
          <Field label="Email" name="email" type="email" required autoComplete="email" />
          <Field label="Username" name="username" required autoComplete="username" hint="3 to 30 letters, numbers, dots, dashes or underscores. You can sign in with it or with your email." /><Field label="Phone" name="phone" type="tel" required autoComplete="tel" /><Field label="Date of birth" name="birth" type="date" required />
          <Field label="Password" name="password" type="password" required autoComplete="new-password" hint="At least 12 characters. A passphrase of unrelated words works well." />
          <Select label={`Requested ${t('department').toLowerCase()}`} name="departmentId" required allowEmpty={false} options={st.departments.filter((d: any) => !d.archived_at).map((d: any) => ({ value: d.id, label: d.name }))} />
          <Select label={`Requested ${t('branch').toLowerCase()}`} name="branchId" required allowEmpty={false} options={st.branches.filter((d: any) => !d.archived_at).map((d: any) => ({ value: d.id, label: d.name }))} />
          <Select label={`Requested ${t('position').toLowerCase()}`} name="positionId" required allowEmpty={false} options={st.positions.filter((d: any) => !d.archived_at).map((d: any) => ({ value: d.id, label: d.name }))} />
          <Select label="Employment type" name="type" required allowEmpty={false} options={['permanent', 'contract', 'probation', 'intern', 'volunteer', 'freelance'].map((x) => ({ value: x, label: x }))} />
        </ActionForm>
          <p className="mt-4 text-center text-sm text-muted">Already approved? <a className="font-semibold underline" href="/login">Sign in</a></p>
        </div>
      </section>
    </main>
  );
}
