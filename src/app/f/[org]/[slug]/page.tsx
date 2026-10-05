import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { publicFormDefinition, submitPublicForm } from '@/server/builders';
import { UserError } from '@/server/ctx';
import { boot } from '@/server/session';
import { resolveConfig } from '@/server/config';
import { withTenant } from '@/server/db';
import { hexToRgbTriplet } from '@/domain/config-schema';
import { DynFields } from '@/components/dyn-fields';
import { PublicForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

async function submit(_p: unknown, f: FormData) {
  'use server';
  await boot();
  const input: Record<string, unknown> = {};
  for (const k of new Set([...f.keys()])) if (!k.startsWith('$ACTION') && k !== '__org' && k !== '__slug') { const a = f.getAll(k).map(String); input[k] = a.length > 1 ? a : a[0]; }
  const h = await headers();
  try {
    const r = await submitPublicForm(String(f.get('__org')), String(f.get('__slug')), input, h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null);
    return { ok: r.number === 'OK' ? 'Thank you. Your submission was received.' : `Thank you. Your reference number is ${r.number}. Please keep it.` };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    console.error(e);
    return { error: 'Sorry, something went wrong. Please try again later.' };
  }
}

export default async function PublicFormPage({ params }: { params: Promise<{ org: string; slug: string }> }) {
  await boot();
  const { org, slug } = await params;
  const d = await publicFormDefinition(org, slug);
  if (!d) notFound();
  const cfg = await withTenant(d.org.id, (q) => resolveConfig(q, d.org.id));
  const b = cfg.branding;
  return (
    <main id="main" className="grid min-h-[100dvh] place-items-center bg-[#0b0b0b] p-4" style={{ ['--brand' as string]: hexToRgbTriplet(b.primary), ['--accent' as string]: hexToRgbTriplet(b.accent), ['--brand-2' as string]: hexToRgbTriplet(b.secondary) }}>
      <div className="w-full max-w-xl">
        {b.logoUrl /* eslint-disable-next-line @next/next/no-img-element */ ? <img src={b.logoUrl} alt={b.name} width={400} height={110} className="mx-auto mb-5 h-auto w-full max-w-[16rem]" /> : <p className="mb-5 text-center text-2xl font-bold text-white">{b.name}</p>}
        <div className="card" style={{ borderTop: `4px solid ${b.accent}` }}>
          <h1 className="text-2xl font-bold">{d.entity.name}</h1>{d.entity.description && <p className="mt-1 text-sm text-muted">{d.entity.description}</p>}
          <PublicForm action={submit as any} org={org} slug={slug}><DynFields fields={d.entity.fields.filter((f) => !['employee', 'department'].includes(f.type))} /></PublicForm>
        </div>
        <p className="mt-4 text-center text-xs text-white/60">{b.footer}</p>
      </div>
    </main>
  );
}
