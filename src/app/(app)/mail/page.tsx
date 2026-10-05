import Link from 'next/link';
import { page, mutate, field } from '@/server/session';
import { directory, listMail, send, type Folder } from '@/server/mail';
import { ActionForm, Field } from '@/components/forms';
import { Empty, PageHead } from '@/components/ui';

export const metadata = { title: 'Mail' };
export const dynamic = 'force-dynamic';

async function compose(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/mail'], async (c) => { await send(c, { to: f.getAll('to').map(String), cc: f.getAll('cc').map(String), subject: field(f, 'subject'), body: field(f, 'body'), priority: field(f, 'priority') }); return 'Sent.'; });
}
const TABS: [Folder, string][] = [['inbox', 'Inbox'], ['sent', 'Sent'], ['archive', 'Archive'], ['trash', 'Trash']];

export default async function Mail({ searchParams }: { searchParams: Promise<{ f?: string; new?: string }> }) {
  const sp = await searchParams;
  return page(async (p) => {
    p.requireFeature('mail');
    const folder = (TABS.find(([k]) => k === sp.f)?.[0] ?? 'inbox') as Folder;
    const [list, dir] = await Promise.all([listMail(p.ctx, folder), directory(p.ctx)]);
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHead title="Mail" sub="Private messages between staff. Only the people on a message can read it."><Link className="btn-primary" href="?new=1#compose">Compose</Link></PageHead>
        <nav className="flex gap-2 overflow-x-auto" aria-label="Folders">{TABS.map(([k, l]) => <Link key={k} href={`?f=${k}`} aria-current={folder === k ? 'page' : undefined} className={`btn ${folder === k ? 'bg-brand text-white' : 'btn-ghost'}`}>{l}</Link>)}</nav>
        {list.length === 0 ? <Empty title="Nothing here" text={folder === 'inbox' ? 'New messages will appear here.' : 'No messages in this folder.'} /> : (
          <ul className="card divide-y divide-line !p-0">{list.map((m: any) => (
            <li key={m.thread_id}><Link href={`/mail/${m.thread_id}`} className={`flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface ${m.read ? '' : 'font-semibold'}`}><span className="min-w-0"><span className="block truncate">{m.priority === 'high' ? '❗ ' : ''}{m.subject}</span><span className="block truncate text-xs font-normal text-muted">{folder === 'sent' ? `To ${m.party}` : m.party}</span></span><span className="shrink-0 text-xs font-normal text-muted">{new Date(m.created_at).toLocaleDateString(p.org.locale)}</span></Link></li>))}</ul>)}
        <section id="compose" className="card" aria-labelledby="c"><h2 id="c" className="font-semibold">New message</h2>
          <ActionForm action={compose as any} submit="Send" className="mt-3">
            <div className="mb-3"><label className="label" htmlFor="to">To (hold Ctrl/Cmd to choose several)</label><select id="to" name="to" multiple required size={5} className="input">{dir.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            <div className="mb-3"><label className="label" htmlFor="cc">Cc (optional)</label><select id="cc" name="cc" multiple size={3} className="input">{dir.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            <Field label="Subject" name="subject" required /><div className="mb-3"><label className="label" htmlFor="body">Message</label><textarea id="body" name="body" rows={6} required className="input py-2" /></div>
            <label className="mb-1 flex items-center gap-2 text-sm"><input type="checkbox" name="priority" value="high" className="h-5 w-5" /> Mark as high priority</label></ActionForm></section>
      </div>
    );
  });
}
