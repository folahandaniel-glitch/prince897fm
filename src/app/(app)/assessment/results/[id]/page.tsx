import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page, mutate, field } from '@/server/session';
import { assessmentResults, resetAttempt } from '@/server/assessment';
import { need, UserError } from '@/server/ctx';
import { ActionForm } from '@/components/forms';
import { Donut } from '@/components/charts';

export const metadata = { title: 'Assessment results' };
export const dynamic = 'force-dynamic';

export default async function Results({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  async function reset(_p: unknown, f: FormData) { 'use server'; return mutate([`/assessment/results/${id}`], async (c) => { await resetAttempt(c, id, field(f, 'employee')); return 'Reset. They can take it again while it is open.'; }); }
  return page(async (p) => {
    p.requireFeature('kpi');
    need(p.ctx, 'assessment:manage');
    let r;
    try { r = await assessmentResults(p.ctx, id); } catch (e) { if (e instanceof UserError) notFound(); throw e; }
    const done = r.rows.filter((x: any) => x.status === 'submitted');
    const passed = done.filter((x: any) => x.passed).length;
    const avg = done.length ? Math.round(done.reduce((a: number, x: any) => a + x.score, 0) / done.length) : null;
    return (
      <div className="min-w-0 space-y-5">
        <Link href="/assessment/manage" className="text-sm underline">← Assessments</Link>
        <header className="card"><h1 className="text-2xl font-bold">{r.assessment.title}</h1><p className="text-sm text-muted">Pass mark {r.assessment.pass_mark}% · {r.assessment.question_count} questions per person{avg != null && <> · average <strong>{avg}%</strong></>}</p>
          <div className="mt-3"><Donut label="Participation" parts={[{ label: 'Passed', value: passed, color: '#16a34a' }, { label: 'Below pass mark', value: done.length - passed, color: '#dc2626' }, { label: 'Not taken', value: r.rows.length - done.length, color: '#94a3b8' }]} /></div></header>
        <div className="card overflow-x-auto p-0"><table className="w-full min-w-[36rem]"><thead><tr className="border-b border-line"><th className="th">Name</th><th className="th">Department</th><th className="th">Result</th><th className="th text-right">Score</th><th className="th" /></tr></thead>
          <tbody>{r.rows.map((x: any) => <tr key={x.employee_id} className="border-b border-line last:border-0"><td className="td font-medium">{x.full_name}</td><td className="td">{x.department ?? '–'}</td>
            <td className="td">{x.status === 'submitted' ? <span className={`badge ${x.passed ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-900'}`}>{x.passed ? 'Passed' : 'Below pass mark'}</span> : x.status === 'in_progress' ? <span className="badge">In progress</span> : <span className="badge">Not taken</span>}</td>
            <td className="td text-right tabular-nums">{x.score == null ? '–' : `${Math.round(x.score)}% (${x.correct}/${x.total})`}</td>
            <td className="td text-right">{x.status && <ActionForm action={reset as any} submit="Reset" tone="ghost" confirm={`Let ${x.full_name} retake this assessment?`} className="!mt-0"><input type="hidden" name="employee" value={x.employee_id} /></ActionForm>}</td></tr>)}</tbody></table></div>
      </div>
    );
  });
}
