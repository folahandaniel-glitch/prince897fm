import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { page } from '@/server/session';
import { startAttempt, submitAttempt } from '@/server/assessment';
import { runAs, UserError } from '@/server/ctx';
import { resolveSession, SESSION_COOKIE } from '@/server/auth';
import { ForbiddenError } from '@/domain/policy';
import { Notice } from '@/components/ui';
import { TakeForm } from './take-form';

export const metadata = { title: 'Assessment' };
export const dynamic = 'force-dynamic';

export default async function Take({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect('/assessment');
  async function submit(_p: unknown, f: FormData) {
    'use server';
    const s = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
    if (!s) redirect('/login');
    const answers: Record<string, string> = {};
    for (const [k, v] of f.entries()) if (k.startsWith('q:') && typeof v === 'string') answers[k.slice(2)] = v;
    try { await runAs(s.org_id, s.user_id, (c) => submitAttempt(c, id, answers)); }
    catch (e) { if (e instanceof UserError) return { error: e.message }; if (e instanceof ForbiddenError) return { error: 'Not permitted.' }; throw e; }
    redirect(`/assessment/review/${id}`);
  }
  return page(async (p) => {
    p.requireFeature('kpi');
    let view;
    try { view = await startAttempt(p.ctx, id); } catch (e) {
      if (e instanceof UserError) return <div className="mx-auto max-w-xl space-y-4"><h1 className="text-2xl font-bold">Assessment</h1><Notice tone="warn">{e.message}</Notice><a className="btn-ghost" href="/assessment">Back to assessments</a></div>;
      throw e;
    }
    return (
      <div className="mx-auto min-w-0 max-w-3xl space-y-4">
        <header><h1 className="text-2xl font-bold">{view.title}</h1><p className="text-sm text-muted">{view.questions.length} questions · pass mark {view.passMark}% · you have {view.minutes} minutes from when you started. Answer every question, then submit once.</p></header>
        <TakeForm action={submit as any} questions={view.questions} deadlineAt={view.deadlineAt} />
      </div>
    );
  });
}
