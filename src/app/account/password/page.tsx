import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { changePassword, SESSION_COOKIE } from '@/server/auth';
import { shell } from '@/server/session';
import { ActionForm, Field } from '@/components/forms';
import { audit } from '@/server/audit';
import { runAs } from '@/server/ctx';

export const metadata = { title: 'Change password' };
export const dynamic = 'force-dynamic';

async function change(_p: unknown, f: FormData) {
  'use server';
  const sh = await shell({ allowPasswordChange: true });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const next = String(f.get('next') ?? '');
  if (next !== String(f.get('confirm') ?? '')) return { error: 'The two new passwords do not match.' };
  const err = await changePassword(sh.s.user_id, sh.s.email, String(f.get('current') ?? ''), next, token);
  if (err) return { error: err };
  await runAs(sh.s.org_id, sh.s.user_id, (c) => audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'account.password_changed', entity: 'user', entityId: c.userId }));
  redirect('/dashboard');
}

export default async function PasswordPage() {
  const sh = await shell({ allowPasswordChange: true });
  return (
    <main id="main" className="grid min-h-[100dvh] place-items-center bg-[#0b0b0b] p-4">
      <div className="card w-full max-w-md">
        <h1 className="text-2xl font-bold">{sh.s.must_change_password ? 'Choose your own password' : 'Change password'}</h1>
        <p className="mt-1 text-sm text-muted">{sh.s.must_change_password ? 'You signed in with a one-time password. Set a personal one to continue.' : 'Other devices will be signed out.'}</p>
        <ActionForm action={change as any} submit="Save password" className="mt-4">
          <Field label="Current password" name="current" type="password" required autoComplete="current-password" />
          <Field label="New password" name="next" type="password" required autoComplete="new-password" hint="At least 12 characters. A passphrase of unrelated words works well." />
          <Field label="Repeat new password" name="confirm" type="password" required autoComplete="new-password" />
        </ActionForm>
      </div>
    </main>
  );
}
