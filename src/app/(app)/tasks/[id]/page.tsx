import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page, mutate, field } from '@/server/session';
import { addComment, createTask, getTask, setTaskStatus } from '@/server/tasks';
import { ActionForm, Field, Select } from '@/components/forms';

export const dynamic = 'force-dynamic';

async function status(_p: unknown, f: FormData) {
  'use server';
  const id = field(f, 'id');
  return mutate([`/tasks/${id}`, '/tasks'], async (c) => { await setTaskStatus(c, id, field(f, 'status')); return 'Status updated.'; });
}
async function comment(_p: unknown, f: FormData) {
  'use server';
  const id = field(f, 'id');
  return mutate([`/tasks/${id}`], async (c) => { await addComment(c, id, field(f, 'body')); return 'Comment added.'; });
}
async function subtask(_p: unknown, f: FormData) {
  'use server';
  const id = field(f, 'id');
  return mutate([`/tasks/${id}`, '/tasks'], async (c) => { await createTask(c, { title: field(f, 'title'), parentId: id }); return 'Subtask added.'; });
}

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return page(async (p) => {
    const d = await getTask(p.ctx, id);
    if (!d) notFound();
    const { task: t, comments, subtasks, canManage } = d;
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <nav className="text-sm text-muted" aria-label="Breadcrumb"><Link className="underline" href="/tasks">Tasks</Link> / {t.title}</nav>
        <header className="card"><h1 className="text-xl font-bold">{t.title}</h1>
          <p className="mt-1 text-sm text-muted">{t.assignee ?? 'Unassigned'} · {t.priority} priority{t.due ? ` · due ${t.due}` : ''}{t.project ? ` · ${t.project}` : ''} · created by {t.creator}</p>
          {t.description && <p className="mt-3 whitespace-pre-wrap text-sm">{t.description}</p>}
          <p className="mt-3"><span className="badge">{t.status.replace('_', ' ')}</span></p>
          {canManage && <ActionForm action={status as any} submit="Update status" tone="ghost" className="mt-3"><input type="hidden" name="id" value={id} />
            <Select label="Status" name="status" allowEmpty={false} defaultValue={t.status} options={['todo', 'in_progress', 'blocked', 'done', 'cancelled'].map((x) => ({ value: x, label: x.replace('_', ' ') }))} /></ActionForm>}</header>

        <section className="card" aria-labelledby="sub"><h2 id="sub" className="font-semibold">Subtasks</h2>
          {subtasks.length === 0 ? <p className="mt-2 text-sm text-muted">No subtasks.</p> : <ul className="mt-2 divide-y divide-line text-sm">{subtasks.map((s: any) => <li key={s.id} className="flex justify-between py-1.5"><Link className="underline" href={`/tasks/${s.id}`}>{s.title}</Link><span className="badge">{s.status.replace('_', ' ')}</span></li>)}</ul>}
          {!t.parent_id && canManage && <ActionForm action={subtask as any} submit="Add subtask" tone="ghost" className="mt-3"><input type="hidden" name="id" value={id} /><Field label="Subtask title" name="title" required /></ActionForm>}</section>

        <section className="card" aria-labelledby="com"><h2 id="com" className="font-semibold">Comments</h2>
          {comments.length === 0 ? <p className="mt-2 text-sm text-muted">No comments yet.</p> : <ul className="mt-2 space-y-3 text-sm">{comments.map((c: any) => <li key={c.id}><p className="text-xs text-muted">{c.email} · {new Date(c.created_at).toLocaleString(p.org.locale, { timeZone: p.org.timezone })}</p><p className="whitespace-pre-wrap">{c.body}</p></li>)}</ul>}
          <ActionForm action={comment as any} submit="Post comment" className="mt-3"><input type="hidden" name="id" value={id} /><div><label className="label" htmlFor="body">Add a comment</label><textarea id="body" name="body" required rows={3} className="input py-2" /></div></ActionForm></section>
      </div>
    );
  });
}
