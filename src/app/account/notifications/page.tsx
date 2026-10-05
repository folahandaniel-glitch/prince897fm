import Link from 'next/link';
import { page, mutate } from '@/server/session';
import { ActionForm } from '@/components/forms';

export const metadata = { title: 'Notification settings' };
export const dynamic = 'force-dynamic';

async function save(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/account/notifications'], async (c) => {
    const email = f.get('email') === 'on';
    await c.q.query('update users set notify_email = $2 where id = $1', [c.userId, email]);
    return email ? 'You will receive important notices by email.' : 'Email notices are switched off. You will still see everything in the app.';
  });
}

export default async function Notifications() {
  return page(async (p) => {
    const on = (await p.ctx.q.query<{ notify_email: boolean }>('select notify_email from users where id = $1', [p.ctx.userId]))[0]?.notify_email ?? true;
    return (
      <div className="mx-auto max-w-lg space-y-5">
        <h1 className="text-2xl font-bold">Notification settings</h1>
        <div className="card"><ActionForm action={save as any} submit="Save"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="email" defaultChecked={on} /> Also email me my notifications ({p.email})</label></ActionForm></div>
        <Link className="text-sm underline" href="/dashboard">Back to dashboard</Link>
      </div>
    );
  });
}
