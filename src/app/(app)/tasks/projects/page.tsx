import Link from 'next/link';
import { page } from '@/server/session';
import { listProjects, listTasks } from '@/server/tasks';
import { PageHead, Empty } from '@/components/ui';

export const metadata = { title: 'Projects' };
export const dynamic = 'force-dynamic';

export default async function Projects({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const sp = await searchParams;
  return page(async (p) => {
    p.requireFeature('tasks');
    const projects = await listProjects(p.ctx.q);
    const team = p.allowed('task:assign');
    const tasks = sp.p ? (await listTasks(p.ctx, team ? 'team' : 'mine')).filter((t: any) => t.project_id === sp.p) : [];
    const cur = projects.find((x: any) => x.id === sp.p);
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHead title="Projects" sub={cur ? cur.name : 'Pick a project to see its tasks.'}>{team && <Link className="btn-ghost" href="/tasks">Add project or task</Link>}</PageHead>
        {projects.length === 0 ? <Empty title="No projects yet" text="Projects group related tasks. Create one from the Tasks page." href="/tasks" action="Open Tasks" /> :
          <div className="flex flex-wrap gap-2">{projects.map((x: any) => <Link key={x.id} href={`?p=${x.id}`} className={`btn ${sp.p === x.id ? 'bg-brand text-white' : 'btn-ghost'}`}>{x.name} · {x.open_tasks}</Link>)}</div>}
        {cur && (tasks.length === 0 ? <Empty title="No tasks you can see in this project" /> : <ul className="space-y-2">{tasks.map((t: any) => (
          <li key={t.id}><Link href={`/tasks/${t.id}`} className="card flex flex-wrap justify-between gap-2 !p-4 hover:border-brand"><span><span className={`font-medium ${t.status === 'done' ? 'line-through text-muted' : ''}`}>{t.title}</span><span className="block text-xs text-muted">{t.assignee ?? 'Unassigned'}{t.due ? ` · due ${t.due}` : ''}</span></span><span className="badge">{t.status.replace('_', ' ')}</span></Link></li>))}</ul>)}
      </div>
    );
  });
}
