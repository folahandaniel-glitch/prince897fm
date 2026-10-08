import Link from 'next/link';
import { page, mutate, field } from '@/server/session';
import { myProfile, saveMyProfile } from '@/server/overview';
import { removePhoto, saveMyPhoto } from '@/server/photo';
import { Avatar } from '@/components/avatar';
import { ActionForm, Field } from '@/components/forms';
import { Notice } from '@/components/ui';

export const metadata = { title: 'My profile' };
export const dynamic = 'force-dynamic';

async function save(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/account/profile', '/dashboard'], async (c) => { await saveMyProfile(c, { phone: field(f, 'phone'), birthDate: field(f, 'birth'), birthdayPrivate: field(f, 'private') === 'on' }); return 'Saved.'; });
}

async function upload(_p: unknown, f: FormData) {
  'use server';
  const file = f.get('photo');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a picture first.' };
  const buf = Buffer.from(await file.arrayBuffer());
  return mutate(['/account/profile', '/dashboard'], async (c) => { const r = await saveMyPhoto(c, buf); return `Saved. Your picture was shrunk to ${(r.bytes / 1000).toFixed(1)} KB (${r.side}×${r.side}) and looks sharp on every screen.`; });
}
async function dropPhoto() { 'use server'; return mutate(['/account/profile', '/dashboard'], async (c) => { await removePhoto(c, c.userId); return 'Picture removed.'; }); }

export default async function Profile() {
  return page(async (p) => {
    const me = await myProfile(p.ctx);
    const sha = (await p.ctx.q.query<{ sha256: string }>('select sha256 from user_photos where user_id = $1', [p.ctx.userId]))[0]?.sha256 ?? null;
    return (
      <div className="mx-auto max-w-lg space-y-5">
        <h1 className="text-2xl font-bold">My profile</h1>
        {!me ? <Notice tone="warn">Your login is not linked to an employee record. Ask HR to link it.</Notice> : (
          <div className="card"><div className="flex items-center gap-4"><Avatar userId={p.ctx.userId} sha={sha} name={me.full_name} size={88} /><div className="min-w-0"><p className="font-semibold">{me.full_name}</p><p className="truncate text-sm text-muted">{p.email}</p></div></div>
            <ActionForm action={upload as any} submit="Save picture" tone="ghost" className="mt-4"><div className="mb-1"><label className="label" htmlFor="photo">Profile picture</label><input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" required className="input py-2" /><p className="mt-1 text-xs text-muted">Any JPEG, PNG or WebP photo (up to 4 MB). We crop it square and shrink it to about 10 KB without visible loss, so it loads instantly.</p></div></ActionForm>
            {sha && <ActionForm action={dropPhoto as any} submit="Remove my picture" tone="ghost" className="mt-2"><span /></ActionForm>}
            <ActionForm action={save as any} submit="Save" className="mt-4"><Field label="Phone" name="phone" defaultValue={me.phone ?? ''} />
              <Field label="Date of birth" name="birth" type="date" defaultValue={me.birth_date ?? ''} hint="Used only to show your birthday on the staff dashboard (day and month, never the year or age)." />
              <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" name="private" defaultChecked={!!me.birthday_private} className="h-5 w-5" /> Do not show my birthday to colleagues</label></ActionForm></div>)}
        <p className="text-sm"><Link className="underline" href="/account/security">Security &amp; password</Link> · <Link className="underline" href="/account/notifications">Notification settings</Link> · <Link className="underline" href="/dashboard">Back to dashboard</Link></p>
      </div>
    );
  });
}
