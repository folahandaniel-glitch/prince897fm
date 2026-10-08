import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page } from '@/server/session';
import { myReview } from '@/server/assessment';
import { Gauge } from '@/components/charts';

export const metadata = { title: 'My assessment result' };
export const dynamic = 'force-dynamic';

export default async function Review({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return page(async (p) => {
    p.requireFeature('kpi');
    const r = await myReview(p.ctx, id);
    if (!r) notFound();
    const passed = r.pct >= r.passMark;
    return (
      <div className="mx-auto min-w-0 max-w-3xl space-y-4">
        <Link href="/assessment" className="text-sm underline">← Assessments</Link>
        <header className="card"><h1 className="text-2xl font-bold">{r.title}</h1><div className="mt-3"><Gauge value={r.pct} label="Assessment score" sub={`${r.correct} of ${r.total} correct · ${passed ? 'Passed' : `Below the ${r.passMark}% pass mark`}`} /></div><p className="mt-2 text-sm text-muted">This score is part of your KPI for the month.</p></header>
        <ol className="space-y-3">{r.items.map((it, i) => { const ok = it.chosen === it.correctKey; return (
          <li key={i} className={`card ${ok ? '!border-emerald-500/50' : '!border-red-500/40'}`}><p className="font-medium"><span className="mr-2 text-muted">{i + 1}.</span>{it.text}</p>
            <ul className="mt-2 space-y-1 text-sm">{it.options.map((o: any) => <li key={o.key} className={`rounded-md px-2 py-1 ${o.key === it.correctKey ? 'bg-emerald-100 font-semibold text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200' : o.key === it.chosen ? 'bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-200' : ''}`}>{o.key}. {o.text}{o.key === it.correctKey ? '  ✓ correct' : o.key === it.chosen ? '  ✗ your answer' : ''}</li>)}</ul>
            {it.chosen == null && <p className="mt-1 text-xs text-muted">You did not answer this one.</p>}</li>); })}</ol>
      </div>
    );
  });
}
