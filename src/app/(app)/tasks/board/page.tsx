import Link from 'next/link';
import { page, mutate, field } from '@/server/session';
import { listTasks, setTaskStatus } from '@/server/tasks';
import { ActionForm } from '@/components/forms';
import { PageHead } from '@/components/ui';

export const metadata = { title: 'Task board' };
export const dynamic = 'force-dynamic';

async function move(_p: unknown, f: FormData) { 'use server'; return mutate(['/tasks/board', '/tasks'], async (c) => { await setTaskStatus(c, field(f, 'id'), field(f, 'to')); return 'Moved.'; }); }
const COLS: [string, string][] = [['todo', 'To do'], ['in_progress', 'In progress'], ['blocked', 'Blocked'], ['done', 'Done']];

export default async function Board({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const sp = await searchParams;
  return page(async (p) => {
    p.requireFeature('tasks');
    const team = p.allowed('task:assign') && sp.scope === 'team';
    const all = await listTasks(p.ctx, team ? 'team' : 'mine');
    const tasks = all.filter((t: any) => t.status !== 'cancelled' && (t.status !== 'done' || true));
    return (
      <div className="space-y-4">
        <PageHead title="Task board" sub={team ? 'Your team' : 'Your tasks'}>
          <Link className={`btn ${!team ? 'bg-brand text-white' : 'btn-ghost'}`} href="?scope=mine">Mine</Link>
          {p.allowed('task:assign') && <Link className={`btn ${team ? 'bg-brand text-white' : 'btn-ghost'}`} href="?scope=team">Team</Link>}
        </PageHead>
        <div className="grid gap-3 md:grid-cols-4">{COLS.map(([k, label]) => {
          const col = tasks.filter((t: any) => t.status === k);
          return (
            <section key={k} className="rounded-2xl border border-line bg-surface p-3" aria-label={label}><h2 className="mb-2 flex justify-between text-sm font-semibold">{label}<span className="text-muted">{col.length}</span></h2>
              <ul className="space-y-2">{col.slice(0, 40).map((t: any) => (
                <li key={t.id} className="rounded-xl border border-line bg-white p-3 text-sm dark:bg-black/20"><Link href={`/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link>
                  <p className="text-xs text-muted">{t.assignee ?? 'Unassigned'}{t.due ? ` · due ${t.due}` : ''}{t.overdue ? ' · overdue' : ''}</p>
                  <div className="mt-2 flex flex-wrap gap-1">{COLS.filter(([x]) => x !== k).map(([x, l]) => (
                    <ActionForm key={x} action={move as any} submit={l} tone="ghost" className="[&>div]:!mt-0"><input type="hidden" name="id" value={t.id} /><input type="hidden" name="to" value={x} /></ActionForm>))}</div></li>))}</ul></section>);
        })}</div>
      </div>
    );
  });
}
