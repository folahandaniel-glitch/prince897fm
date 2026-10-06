import { page, mutate, field } from '@/server/session';
import { activeAnnouncements, postAnnouncement, removeAnnouncement, updateAnnouncement } from '@/server/calendar';
import { need } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';
import { Empty, PageHead } from '@/components/ui';

export const metadata = { title: 'Announcements' };
export const dynamic = 'force-dynamic';

const MANAGERS = ['hr_manager', 'department_head', 'executive', 'ceo', 'tenant_admin', 'finance_manager'];
const PATHS = ['/announcements', '/dashboard'];

async function post(_p: unknown, f: FormData) {
  'use server';
  return mutate(PATHS, async (c) => {
    await postAnnouncement(c, { title: field(f, 'title'), body: field(f, 'body'), roles: field(f, 'who') === 'managers' ? MANAGERS : ['*'], pinned: field(f, 'pinned') === 'on', expiresOn: field(f, 'expires') || undefined });
    return 'Posted. It now rotates in the banner at the top of every page.';
  });
}
async function edit(_p: unknown, f: FormData) {
  'use server';
  return mutate(PATHS, async (c) => {
    await updateAnnouncement(c, field(f, 'id'), { title: field(f, 'title'), body: field(f, 'body'), roles: field(f, 'who') === 'managers' ? MANAGERS : ['*'], pinned: field(f, 'pinned') === 'on', startsOn: field(f, 'starts') || undefined, expiresOn: field(f, 'expires') || undefined });
    return 'Saved.';
  });
}
async function remove(_p: unknown, f: FormData) { 'use server'; return mutate(PATHS, async (c) => { await removeAnnouncement(c, field(f, 'id')); return 'Removed.'; }); }

export default async function Announcements() {
  return page(async (p) => {
    need(p.ctx, 'announcement:post');
    const list = await activeAnnouncements(p.ctx);
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <PageHead title="Announcements" sub="Messages that rotate in the banner at the top of every page." />
        <section className="card"><h2 className="font-semibold">Post an announcement</h2>
          <ActionForm action={post as any} submit="Post" className="mt-3"><Field label="Title" name="title" required />
            <div className="mb-3"><label className="label" htmlFor="body">Message</label><textarea id="body" name="body" rows={3} required className="input py-2" /></div>
            <div className="grid gap-x-4 sm:grid-cols-3"><Select label="Audience" name="who" allowEmpty={false} defaultValue="all" options={[{ value: 'all', label: 'All staff' }, { value: 'managers', label: 'Managers only' }]} /><Field label="Show until (optional)" name="expires" type="date" />
              <label className="mt-7 flex items-center gap-2 text-sm"><input type="checkbox" name="pinned" className="h-5 w-5" /> Pin</label></div></ActionForm></section>
        <section><h2 className="mb-2 font-semibold">Current <span className="text-muted">({list.length})</span></h2>
          {list.length === 0 ? <Empty title="No active announcements" /> : (
            <ul className="space-y-3">{list.map((a: any) => (
              <li key={a.id} className="card"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">{a.title}{a.pinned && <span className="badge ml-2">Pinned</span>}</p><p className="whitespace-pre-wrap text-sm text-muted">{a.body}</p></div>
                <ActionForm action={remove as any} submit="Remove" tone="ghost" confirm="Remove this announcement?" className="!mt-0"><input type="hidden" name="id" value={a.id} /></ActionForm></div>
                <details className="mt-2"><summary className="cursor-pointer text-sm font-medium underline">Edit</summary>
                  <ActionForm action={edit as any} submit="Save changes" className="mt-3"><input type="hidden" name="id" value={a.id} />
                    <Field label="Title" name="title" required defaultValue={a.title} />
                    <div className="mb-3"><label className="label" htmlFor={`b-${a.id}`}>Message</label><textarea id={`b-${a.id}`} name="body" rows={3} required defaultValue={a.body} className="input py-2" /></div>
                    <div className="grid gap-x-4 sm:grid-cols-4"><Select label="Audience" name="who" allowEmpty={false} defaultValue={Array.isArray(a.roles) && a.roles.includes('*') ? 'all' : 'managers'} options={[{ value: 'all', label: 'All staff' }, { value: 'managers', label: 'Managers only' }]} />
                      <Field label="Starts" name="starts" type="date" defaultValue={String(a.starts_on ?? '').slice(0, 10)} /><Field label="Show until" name="expires" type="date" defaultValue={a.expires_on ? String(a.expires_on).slice(0, 10) : ''} />
                      <label className="mt-7 flex items-center gap-2 text-sm"><input type="checkbox" name="pinned" defaultChecked={!!a.pinned} className="h-5 w-5" /> Pin</label></div></ActionForm></details></li>))}</ul>)}</section>
      </div>
    );
  });
}
