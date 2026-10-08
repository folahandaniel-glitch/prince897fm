import Link from 'next/link';
import { page, mutate, field } from '@/server/session';
import { myProfile, saveMyProfile } from '@/server/overview';
import { ActionForm, Field } from '@/components/forms';
import { Notice } from '@/components/ui';

export const metadata = { title: 'My profile' };
export const dynamic = 'force-dynamic';

async function save(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/account/profile', '/dashboard'], async (c) => { await saveMyProfile(c, { phone: field(f, 'phone'), birthDate: field(f, 'birth'), birthdayPrivate: field(f, 'private') === 'on' }); return 'Saved.'; });
}

export default async function Profile() {
  return page(async (p) => {
    const me = await myProfile(p.ctx);
    return (
      <div className="mx-auto max-w-lg space-y-5">
        <h1 className="text-2xl font-bold">My profile</h1>
        {!me ? <Notice tone="warn">Your login is not linked to an employee record. Ask HR to link it.</Notice> : (
          <div className="card"><p className="font-semibold">{me.full_name}</p><p className="text-sm text-muted">{p.email}</p>
            <ActionForm action={save as any} submit="Save" className="mt-4"><Field label="Phone" name="phone" defaultValue={me.phone ?? ''} />
              <Field label="Date of birth" name="birth" type="date" defaultValue={me.birth_date ?? ''} hint="Used only to show your birthday on the staff dashboard (day and month, never the year or age)." />
              <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" name="private" defaultChecked={!!me.birthday_private} className="h-5 w-5" /> Do not show my birthday to colleagues</label></ActionForm></div>)}
        <p className="text-sm"><Link className="underline" href="/account/security">Security &amp; password</Link> · <Link className="underline" href="/account/notifications">Notification settings</Link> · <Link className="underline" href="/dashboard">Back to dashboard</Link></p>
      </div>
    );
  });
}
