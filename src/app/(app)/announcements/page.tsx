import { page, mutate, field } from '@/server/session';
import { activeAnnouncements, postAnnouncement, removeAnnouncement } from '@/server/calendar';
import { need } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';
import { Empty, PageHead } from '@/components/ui';

export const metadata = { title: 'Announcements' };
export const dynamic = 'force-dynamic';

async function post(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/announcements', '/dashboard'], async (c) => { await postAnnouncement(c, { title: field(f, 'title'), body: field(f, 'body'), roles: field(f, 'who') === 'managers' ? ['hr_manager', 'department_head', 'executive', 'ceo', 'tenant_admin', 'finance_manager'] : ['*'], pinned: field(f, 'pinned') === 'on', expiresOn: field(f, 'expires') || undefined }); return 'Posted. It appears at the top of the dashboard.'; });
}
async function remove(_p: unknown, f: FormData) { 'use server'; return mutate(['/announcements', '/dashboard'], async (c) => { await removeAnnouncement(c, field(f, 'id')); return 'Removed.'; }); }

export default async function Announcements() {
  return page(async (p) => {
    need(p.ctx, 'announcement:post');
    const list = await activeAnnouncements(p.ctx);
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <PageHead title="Announcements" sub="Messages shown at the top of everyone's dashboard." />
        <section className="card"><h2 className="font-semibold">Post an announcement</h2><ActionForm action={post as any} submit="Post" className="mt-3"><Field label="Title" name="title" required /><div className="mb-3"><label className="label" htmlFor="body">Message</label><textarea id="body" name="body" rows={3} required className="input py-2" /></div>
          <div className="grid gap-x-4 sm:grid-cols-3"><Select label="Audience" name="who" allowEmpty={false} defaultValue="all" options={[{ value: 'all', label: 'All staff' }, { value: 'managers', label: 'Managers only' }]} /><Field label="Remove after" name="expires" type="date" /><label className="mt-7 flex items-center gap-2 text-sm"><input type="checkbox" name="pinned" className="h-5 w-5" /> Pin to top</label></div></ActionForm></section>
        <section><h2 className="mb-2 font-semibold">Current</h2>{list.length === 0 ? <Empty title="No active announcements" /> : <ul className="space-y-2">{list.map((a: any) => <li key={a.id} className="card flex flex-wrap items-start justify-between gap-2"><span><strong>{a.pinned ? '📌 ' : ''}{a.title}</strong><span className="block text-sm text-muted">{a.body}</span></span><ActionForm action={remove as any} submit="Remove" tone="ghost" className="!mt-0" confirm="Remove this announcement?"><input type="hidden" name="id" value={a.id} /><span /></ActionForm></li>)}</ul>}</section>
      </div>
    );
  });
}
