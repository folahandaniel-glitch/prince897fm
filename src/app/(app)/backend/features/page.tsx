import { page, mutate, field } from '@/server/session';
import { listFeatures, setFeature } from '@/server/backend';
import { ActionForm } from '@/components/forms';

export const metadata = { title: 'Modules · BackEnd' };
export const dynamic = 'force-dynamic';

async function toggle(_p: unknown, f: FormData) { 'use server'; return mutate(['/backend/features', '/dashboard'], async (c) => { await setFeature(c, field(f, 'key'), field(f, 'on') === 'true'); return 'Updated. The menu changes straight away.'; }); }

export default async function Features() {
  return page(async (p) => {
    const features = await listFeatures(p.ctx);
    return (
      <ul className="grid gap-3 sm:grid-cols-2">{features.map((f) => (
        <li key={f.key} className="card flex items-center justify-between gap-3"><div><p className="font-semibold">{f.label}</p><p className="text-xs text-muted">{f.note}</p></div>
          <ActionForm action={toggle as any} submit={f.enabled ? 'Turn off' : 'Turn on'} tone={f.enabled ? 'ghost' : 'primary'} className="!mt-0"><input type="hidden" name="key" value={f.key} /><input type="hidden" name="on" value={String(!f.enabled)} /><span /></ActionForm></li>))}</ul>
    );
  });
}
