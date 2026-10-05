import Link from 'next/link';
import QRCode from 'qrcode';
import { shell } from '@/server/session';
import { privileged } from '@/server/db';
import { decryptSecret, encryptSecret, generateSecret, otpauthUri, verifyTotp } from '@/server/mfa';
import { audit } from '@/server/audit';
import { runAs } from '@/server/ctx';
import { revalidatePath } from 'next/cache';
import { ActionForm, Field } from '@/components/forms';

export const metadata = { title: 'Account security' };
export const dynamic = 'force-dynamic';

async function enable(_p: unknown, f: FormData) {
  'use server';
  const sh = await shell();
  const secret = String(f.get('secret') ?? '');
  if (!/^[A-Z2-7]{32}$/.test(secret)) return { error: 'Start again: reload this page to get a new code.' };
  if (!verifyTotp(secret, String(f.get('code') ?? ''))) return { error: 'That code is not right. Check the time on your phone and try the next code.' };
  await (await privileged()).query('update users set mfa_secret_enc = $2, mfa_enabled = true where id = $1', [sh.s.user_id, encryptSecret(secret)]);
  await runAs(sh.s.org_id, sh.s.user_id, (c) => audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'account.mfa_enabled', entity: 'user', entityId: c.userId }));
  revalidatePath('/account/security');
  return { ok: 'Two-step verification is now on.' };
}
async function disable(_p: unknown, f: FormData) {
  'use server';
  const sh = await shell();
  const row = (await (await privileged()).query<any>('select mfa_secret_enc from users where id = $1', [sh.s.user_id]))[0];
  if (!row?.mfa_secret_enc || !verifyTotp(decryptSecret(row.mfa_secret_enc), String(f.get('code') ?? ''))) return { error: 'Enter a current code from your authenticator app to turn this off.' };
  await (await privileged()).query('update users set mfa_secret_enc = null, mfa_enabled = false where id = $1', [sh.s.user_id]);
  await runAs(sh.s.org_id, sh.s.user_id, (c) => audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'account.mfa_disabled', entity: 'user', entityId: c.userId }));
  revalidatePath('/account/security');
  return { ok: 'Two-step verification is off.' };
}

export default async function SecurityPage() {
  const sh = await shell();
  const on = sh.s.mfa_enabled;
  let secret = '', qr = '';
  if (!on) { secret = generateSecret(); qr = await QRCode.toString(otpauthUri(secret, sh.s.email, sh.cfg.branding.shortName), { type: 'svg', margin: 1, width: 192 }); }
  return (
    <main id="main" className="mx-auto max-w-lg space-y-4 p-4 sm:p-8">
      <Link href="/dashboard" className="text-sm underline">← Back</Link>
      <h1 className="text-2xl font-bold">Account security</h1>
      <section className="card"><h2 className="font-semibold">Two-step verification</h2>
        {on ? (<>
          <p className="mt-1 text-sm text-muted">On. You are asked for a code from your authenticator app each time you sign in.</p>
          <ActionForm action={disable as any} submit="Turn off" tone="danger" className="mt-3"><Field label="Current code" name="code" required /></ActionForm>
        </>) : (<>
          <p className="mt-1 text-sm text-muted">Protect your account with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password). Strongly recommended for administrators, finance staff and executives.</p>
          <div className="mt-3 flex flex-wrap items-center gap-4"><div className="rounded-lg bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} aria-label="QR code for your authenticator app" role="img" />
            <p className="max-w-[16rem] break-all text-xs text-muted">Can&apos;t scan? Enter this key manually:<br /><code className="text-sm text-ink">{secret}</code></p></div>
          <ActionForm action={enable as any} submit="Turn on" className="mt-3"><input type="hidden" name="secret" value={secret} /><Field label="6-digit code from the app" name="code" required /></ActionForm>
        </>)}
      </section>
      <Link href="/account/password" className="btn-ghost">Change password</Link>
    </main>
  );
}
