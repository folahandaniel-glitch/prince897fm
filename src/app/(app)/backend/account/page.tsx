import { cookies } from 'next/headers';
import { page, mutate, field } from '@/server/session';
import { changeLoginEmail, changePassword, SESSION_COOKIE } from '@/server/auth';
import { audit } from '@/server/audit';
import { need, UserError } from '@/server/ctx';
import { ActionForm, Field } from '@/components/forms';

export const metadata = { title: 'My account · BackEnd' };
export const dynamic = 'force-dynamic';

async function pw(_p: unknown, f: FormData) {
  'use server';
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return mutate(['/backend/account'], async (c) => {
    need(c, 'backend:access');
    if (field(f, 'next') !== field(f, 'confirm')) throw new UserError('The two new passwords do not match.');
    const email = (await c.q.query<{ email: string }>('select email from users where id = $1', [c.userId]))[0].email;
    const err = await changePassword(c.userId, email, field(f, 'current'), field(f, 'next'), token);
    if (err) throw new UserError(err);
    await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'account.password_changed', entity: 'user', entityId: c.userId, ip: c.ip, userAgent: c.userAgent });
    return 'Password changed. Your other devices were signed out.';
  });
}

async function mail(_p: unknown, f: FormData) {
  'use server';
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return mutate(['/backend/account'], async (c) => {
    need(c, 'backend:access');
    const err = await changeLoginEmail(c.userId, field(f, 'current'), field(f, 'email'), token);
    if (err) throw new UserError(err);
    await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'account.email_changed', entity: 'user', entityId: c.userId, ip: c.ip, userAgent: c.userAgent });
    return 'Sign-in email changed. Use the new address next time.';
  });
}

export default async function Account() {
  return page(async (p) => {
    need(p.ctx, 'backend:access');
    return (
      <div className="mx-auto max-w-xl space-y-5">
        <section className="card"><h2 className="font-semibold">Change password</h2>
          <p className="mt-1 text-sm text-muted">At least 12 characters; a passphrase of unrelated words works well. Other devices are signed out.</p>
          <ActionForm action={pw as any} submit="Save password" className="mt-3">
            <Field label="Current password" name="current" type="password" required autoComplete="current-password" />
            <Field label="New password" name="next" type="password" required autoComplete="new-password" />
            <Field label="Repeat new password" name="confirm" type="password" required autoComplete="new-password" /></ActionForm></section>
        <section className="card"><h2 className="font-semibold">Sign-in email</h2>
          <p className="mt-1 text-sm text-muted">Currently <strong>{p.email}</strong>. Changing it needs your current password.</p>
          <ActionForm action={mail as any} submit="Change email" tone="ghost" className="mt-3">
            <Field label="New email" name="email" type="email" required autoComplete="email" />
            <Field label="Current password" name="current" type="password" required autoComplete="current-password" /></ActionForm></section>
        <p className="text-sm text-muted">Two-step verification for this account is under <a className="underline" href="/account/security">Security &amp; password</a>.</p>
      </div>
    );
  });
}
