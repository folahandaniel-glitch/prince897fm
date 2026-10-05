import Link from 'next/link';
import { page, mutate, field, optional } from '@/server/session';
import { assignableEmployees, createProject, createTask, listProjects, listTasks } from '@/server/tasks';
import { ActionForm, Field, Select } from '@/components/forms';

export const metadata = { title: 'Tasks' };
export const dynamic = 'force-dynamic';

async function create(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/tasks'], async (c) => { await createTask(c, { title: field(f, 'title'), description: field(f, 'description'), assigneeId: optional(f, 'assigneeId'), projectId: optional(f, 'projectId'), priority: field(f, 'priority'), dueDate: field(f, 'dueDate') || undefined }); return 'Task created.'; });
}
async function project(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/tasks'], async (c) => { await createProject(c, field(f, 'name')); return 'Project created.'; });
}

const PRIO: Record<string, string> = { urgent: 'bg-red-100 text-red-900', high: 'bg-amber-100 text-amber-900', normal: '', low: '' };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ scope?: string; status?: string }> }) {
  const sp = await searchParams;
  return page(async (p) => {
    const canTeam = p.allowed('task:assign');
    const scope = (['mine', 'created', 'team'].includes(sp.scope ?? '') ? sp.scope : 'mine') as 'mine' | 'created' | 'team';
    const status = sp.status === 'all' ? undefined : sp.status ?? 'open';
    const [tasks, people, projects] = await Promise.all([listTasks(p.ctx, scope === 'team' && !canTeam ? 'mine' : scope, status), assignableEmployees(p.ctx), listProjects(p.ctx.q)]);
    const tab = (s: string, label: string) => <Link key={s} href={`?scope=${s}&status=${status ?? 'all'}`} aria-current={scope === s ? 'page' : undefined} className={`btn ${scope === s ? 'bg-brand text-white' : 'btn-ghost'}`}>{label}</Link>;
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Tasks</h1>
        <nav className="flex flex-wrap gap-2" aria-label="Task lists">{tab('mine', 'Assigned to me')}{tab('created', 'Created by me')}{canTeam && tab('team', 'Team')}
          <Link className="btn-ghost ml-auto" href={`?scope=${scope}&status=${status === undefined ? 'open' : 'all'}`}>{status === undefined ? 'Show open only' : 'Show completed too'}</Link></nav>

        {tasks.length === 0 ? <div className="card text-center"><p className="font-semibold">{scope === 'mine' ? 'No tasks assigned to you' : 'No tasks here'}</p><p className="mt-1 text-sm text-muted">Create one below to get started.</p></div> :
          <ul className="space-y-2">{tasks.map((t: any) => (
            <li key={t.id}><Link href={`/tasks/${t.id}`} className="card flex flex-wrap items-center justify-between gap-2 !p-4 hover:border-brand">
              <span><span className={`font-medium ${t.status === 'done' ? 'line-through text-muted' : ''}`}>{t.parent_id ? '↳ ' : ''}{t.title}</span>
                <span className="block text-xs text-muted">{t.assignee ?? 'Unassigned'}{t.project ? ` · ${t.project}` : ''}{t.due ? ` · due ${t.due}` : ''}</span></span>
              <span className="flex gap-1">{t.overdue && <span className="badge bg-red-100 text-red-900">overdue</span>}<span className={`badge ${PRIO[t.priority]}`}>{t.priority}</span><span className="badge">{t.status.replace('_', ' ')}</span></span></Link></li>))}</ul>}

        <section className="card" aria-labelledby="new"><h2 id="new" className="font-semibold">New task</h2>
          <ActionForm action={create as any} submit="Create task" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="Title" name="title" required /><Field label="Due date" name="dueDate" type="date" />
            <Select label="Priority" name="priority" allowEmpty={false} defaultValue="normal" options={['low', 'normal', 'high', 'urgent'].map((x) => ({ value: x, label: x }))} />
            {projects.length > 0 && <Select label="Project" name="projectId" options={projects.map((x: any) => ({ value: x.id, label: x.name }))} />}
            {canTeam && <Select label="Assign to (blank = me)" name="assigneeId" options={people.map((x: any) => ({ value: x.id, label: x.full_name }))} />}</div>
            <div className="mb-1"><label className="label" htmlFor="description">Details</label><textarea id="description" name="description" rows={3} className="input py-2" /></div></ActionForm></section>

        {canTeam && <section className="card" aria-labelledby="proj"><h2 id="proj" className="font-semibold">Projects</h2>
          <ul className="mt-2 text-sm">{projects.map((x: any) => <li key={x.id} className="flex justify-between py-1"><span>{x.name}</span><span className="text-muted">{x.open_tasks} open</span></li>)}</ul>
          <ActionForm action={project as any} submit="Add project" tone="ghost" className="mt-3"><Field label="Project name" name="name" required /></ActionForm></section>}
      </div>
    );
  });
}
