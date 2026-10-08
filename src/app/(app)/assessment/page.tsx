import Link from 'next/link';
import { redirect } from 'next/navigation';
import { page, mutate } from '@/server/session';
import { listAssessments, startAttempt } from '@/server/assessment';
import { need, UserError } from '@/server/ctx';
import { ActionForm } from '@/components/forms';
import { Empty, PageHead } from '@/components/ui';
import { runAs } from '@/server/ctx';
import { cookies } from 'next/headers';
import { resolveSession, SESSION_COOKIE } from '@/server/auth';

export const metadata = { title: 'Monthly assessment' };
export const dynamic = 'force-dynamic';

async function start(_p: unknown, f: FormData) {
  'use server';
  const id = String(f.get('id') ?? '');
  const s = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) redirect('/login');
  try { await runAs(s.org_id, s.user_id, (c) => startAttempt(c, id)); } catch (e) { if (e instanceof UserError) return { error: e.message }; throw e; }
  redirect(`/assessment/take/${id}`);
}
void mutate;

export default async function Assessments() {
  return page(async (p) => {
    p.requireFeature('kpi');
    need(p.ctx, 'assessment:take');
    const list = await listAssessments(p.ctx);
    return (
      <div className="mx-auto min-w-0 max-w-3xl space-y-5">
        <PageHead title="Monthly knowledge assessment" sub="Product and service knowledge questions. Your score counts towards your KPI.">{p.allowed('assessment:manage') && <Link href="/assessment/manage" className="btn-ghost">Manage assessments</Link>}</PageHead>
        {list.length === 0 ? <Empty title="No assessment yet" text="When your administrator schedules this month's assessment it will appear here, and you will get a notification." /> : (
          <ul className="space-y-3">{list.map((a: any) => (
            <li key={a.id} className="card"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold">{a.title}</p><p className="text-sm text-muted">{a.question_count} questions · {a.minutes} minutes · pass mark {a.pass_mark}% · {a.opens_on} to {a.closes_on}</p>
              {a.attempt_status === 'submitted' && <p className="mt-1 text-sm">Your score: <strong className={a.passed ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}>{Math.round(a.score)}%</strong> ({a.correct}/{a.total}) · {a.passed ? 'Passed' : 'Below the pass mark'}</p>}</div>
              <div className="shrink-0">{a.attempt_status === 'submitted' ? <Link href={`/assessment/review/${a.id}`} className="btn-ghost">See my answers</Link>
                : a.state === 'open' ? <ActionForm action={start as any} submit={a.attempt_status === 'in_progress' ? 'Continue' : 'Start'} className="!mt-0"><input type="hidden" name="id" value={a.id} /></ActionForm>
                : <span className="badge">{a.state === 'upcoming' ? 'Not open yet' : 'Closed: not taken'}</span>}</div></div></li>))}</ul>)}
        <p className="text-sm text-muted">You can take each assessment once. Questions are chosen for you; the right answers are shown only after you submit.</p>
      </div>
    );
  });
}
