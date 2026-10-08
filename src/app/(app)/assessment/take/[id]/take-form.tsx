'use client';
import { useActionState, useEffect, useRef, useState } from 'react';

type Q = { id: string; text: string; options: { key: string; text: string }[] };
type S = { error?: string } | null;

/** The question sheet with a visible countdown. When time runs out the answers given so far are submitted automatically. */
export function TakeForm({ action, questions, deadlineAt }: { action: (p: S, d: FormData) => Promise<S>; questions: Q[]; deadlineAt: string }) {
  const [state, run, pending] = useActionState(action, null);
  const [left, setLeft] = useState(() => Math.max(0, Math.round((new Date(deadlineAt).getTime() - Date.now()) / 1000)));
  const [answered, setAnswered] = useState(0);
  const ref = useRef<HTMLFormElement>(null);
  const sent = useRef(false);
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.round((new Date(deadlineAt).getTime() - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [deadlineAt]);
  useEffect(() => { if (left === 0 && !sent.current) { sent.current = true; ref.current?.requestSubmit(); } }, [left]);
  const mm = String(Math.floor(left / 60)).padStart(2, '0'), ss = String(left % 60).padStart(2, '0');
  return (
    <form ref={ref} action={run} onChange={() => setAnswered(ref.current ? new Set([...new FormData(ref.current).keys()].filter((k) => k.startsWith('q:'))).size : 0)}>
      <div className="sticky top-14 z-20 mb-4 flex items-center justify-between gap-3 rounded-xl border border-line bg-panel/95 px-4 py-2 backdrop-blur" role="timer" aria-live="off">
        <span className="text-sm">Answered <strong>{answered}</strong> of {questions.length}</span><span className={`font-mono text-lg font-bold tabular-nums ${left < 120 ? 'text-red-600' : ''}`}>{mm}:{ss}</span></div>
      <ol className="space-y-4">{questions.map((q, i) => (
        <li key={q.id} className="card"><fieldset><legend className="font-medium"><span className="mr-2 text-muted">{i + 1}.</span>{q.text}</legend>
          <div className="mt-3 space-y-2">{q.options.map((o) => (
            <label key={o.key} className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface has-[:checked]:border-[rgb(var(--accent))] has-[:checked]:bg-accent/10">
              <input type="radio" name={`q:${q.id}`} value={o.key} className="mt-0.5 h-5 w-5 shrink-0" /><span><strong className="mr-1">{o.key}.</strong>{o.text}</span></label>))}</div></fieldset></li>))}</ol>
      <p role="alert" aria-live="assertive" className="mt-3 min-h-5 text-sm text-red-700 dark:text-red-400">{state?.error}</p>
      <button type="submit" disabled={pending} className="btn-primary mt-2 w-full sm:w-auto" onClick={(e) => { if (answered < questions.length && !window.confirm(`You have answered ${answered} of ${questions.length}. Submit anyway? You cannot change your answers afterwards.`)) e.preventDefault(); }}>{pending ? 'Submitting…' : 'Submit my answers'}</button>
    </form>
  );
}
