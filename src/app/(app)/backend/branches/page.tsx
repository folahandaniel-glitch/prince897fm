import { page, mutate, field } from '@/server/session';
import { listBranches, saveBranch } from '@/server/branches';
import { archiveStructure } from '@/server/hr';
import { need } from '@/server/ctx';
import { ActionForm, Field } from '@/components/forms';
import { CoordsInput } from '@/components/coords-input';
import { Empty } from '@/components/ui';

export const metadata = { title: 'Branches & locations · BackEnd' };
export const dynamic = 'force-dynamic';

async function save(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/backend/branches', '/admin/structure', '/attendance'], async (c) => {
    await saveBranch(c, { id: field(f, 'id') || undefined, name: field(f, 'name'), code: field(f, 'code'), region: field(f, 'region'), address: field(f, 'address'), phone: field(f, 'phone'), coordinates: field(f, 'coordinates'), radiusM: Number(field(f, 'radius') || 150), headquarters: field(f, 'hq') === 'on' });
    return field(f, 'id') ? 'Branch updated. Attendance checks use the new location straight away.' : 'Branch added.';
  });
}
async function archive(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/backend/branches', '/admin/structure'], async (c) => { await archiveStructure(c, 'branch', field(f, 'id'), field(f, 'reason') || 'Archived from BackEnd'); return 'Branch archived. History is kept.'; });
}

const Form = ({ b }: { b?: any }) => (
  <ActionForm action={save as any} submit={b ? 'Save changes' : 'Add branch'} className="mt-3">
    {b && <input type="hidden" name="id" value={b.id} />}
    <div className="grid gap-x-4 sm:grid-cols-2">
      <Field label="Branch name" name="name" required defaultValue={b?.name} placeholder="e.g. Ibadan Headquarters" />
      <Field label="Code (optional)" name="code" defaultValue={b?.code ?? ''} placeholder="e.g. IBD" />
      <Field label="Region / city" name="region" defaultValue={b?.region ?? ''} />
      <Field label="Phone" name="phone" defaultValue={b?.phone ?? ''} />
    </div>
    <Field label="Address" name="address" defaultValue={b?.address ?? ''} />
    <CoordsInput defaultValue={b?.lat != null ? `${b.lat}, ${b.lng}` : ''} />
    <div className="grid gap-x-4 sm:grid-cols-2">
      <Field label="Clock-in radius (metres)" name="radius" type="number" defaultValue={String(b?.radius ?? 150)} hint="How far from the point staff may be and still clock in (20 to 5000). Widen it if staff get false 'outside' results." />
      <label className="mt-7 flex items-center gap-2 text-sm"><input type="checkbox" name="hq" defaultChecked={!!b?.is_headquarters} className="h-5 w-5" /> This is the headquarters</label>
    </div>
  </ActionForm>
);

export default async function Branches() {
  return page(async (p) => {
    need(p.ctx, 'structure:manage');
    const rows = await listBranches(p.ctx);
    return (
      <div className="space-y-5">
        <p className="text-sm text-muted">Set the Google coordinates of each branch. Staff clock in against these points; a matching geofence is kept in sync automatically.</p>
        <section className="card"><h2 className="font-semibold">Add a branch</h2><Form /></section>
        {rows.length === 0 ? <Empty title="No branches yet" /> : <ul className="space-y-3">{rows.map((b: any) => (
          <li key={b.id} className={`card ${b.archived_at ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="font-semibold">{b.name}{b.is_headquarters && <span className="badge ml-2">Headquarters</span>}{b.archived_at && <span className="badge ml-2">Archived</span>}</p>
                <p className="text-sm text-muted">{[b.code, b.region, b.address].filter(Boolean).join(' · ') || 'No details yet'} · {b.staff} staff</p>
                <p className="mt-1 text-sm">{b.map ? <>📍 {b.lat}, {b.lng} · {b.radius} m · <a className="underline" target="_blank" rel="noreferrer" href={b.map}>Open in Google Maps</a></> : <span className="text-amber-700 dark:text-amber-400">No coordinates yet: clock-in cannot be checked for this branch.</span>}</p></div>
            </div>
            {!b.archived_at && <details className="mt-3"><summary className="cursor-pointer text-sm font-medium underline">Edit</summary><Form b={b} />
              <ActionForm action={archive as any} submit="Archive branch" tone="danger" confirm="Archive this branch? It can no longer be chosen for new assignments." className="mt-4 border-t border-line pt-3"><input type="hidden" name="id" value={b.id} /><Field label="Reason" name="reason" /></ActionForm></details>}
          </li>))}</ul>}
      </div>
    );
  });
}
