'use client';
import { useActionState } from 'react';

type Q = { text: string; options: { key: string; text: string }[]; correctKey: string; line: number };
export type UploadState = { error?: string; ok?: string; preview?: { filename: string; kind: string; questions: Q[]; issues: { line: number; message: string }[] } } | null;

/** Step 1: choose a Word, PDF or PowerPoint file and read it. Step 2: check what was found, then import. Nothing is saved until step 2. */
export function BankUploader({ preview, doImport }: { preview: (p: UploadState, d: FormData) => Promise<UploadState>; doImport: (p: UploadState, d: FormData) => Promise<UploadState> }) {
  const [pv, runPreview, reading] = useActionState(preview, null);
  const [im, runImport, importing] = useActionState(doImport, null);
  const p = pv?.preview;
  return (
    <div className="space-y-4">
      <form action={runPreview} className="space-y-3">
        <div><label className="label" htmlFor="file">Question file (.docx, .pdf or .pptx, up to 5 MB)</label><input id="file" name="file" type="file" required accept=".docx,.pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation" className="input py-2" /></div>
        <p className="text-xs text-muted">Write each question on its own line, the options under it (A. B. C. D.), and put <strong>*</strong> in front of the correct option, for example <code>*B. 89.7 FM</code>. Leave a blank line between questions.</p>
        <button disabled={reading} className="btn-ghost">{reading ? 'Reading the file…' : 'Read the file'}</button>
        {pv?.error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{pv.error}</p>}
      </form>
      {p && (
        <section className="rounded-xl border border-line p-4" aria-live="polite">
          <h3 className="font-semibold">Found {p.questions.length} valid question{p.questions.length === 1 ? '' : 's'} in {p.filename}</h3>
          {p.issues.length > 0 && <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"><p className="font-medium">{p.issues.length} item{p.issues.length === 1 ? '' : 's'} need attention and will be left out:</p><ul className="mt-1 list-disc pl-5">{p.issues.slice(0, 8).map((x, i) => <li key={i}>{x.message}</li>)}</ul>{p.issues.length > 8 && <p className="mt-1 text-xs">…and {p.issues.length - 8} more. Fix the file and read it again.</p>}</div>}
          <ol className="mt-3 max-h-80 space-y-3 overflow-auto text-sm">{p.questions.slice(0, 6).map((q, i) => (
            <li key={i}><p className="font-medium">{i + 1}. {q.text}</p><ul className="ml-4">{q.options.map((o) => <li key={o.key} className={o.key === q.correctKey ? 'font-semibold text-emerald-700 dark:text-emerald-400' : ''}>{o.key}. {o.text}{o.key === q.correctKey ? ' ✓' : ''}</li>)}</ul></li>))}</ol>
          {p.questions.length > 6 && <p className="mt-1 text-xs text-muted">Showing the first 6 of {p.questions.length}.</p>}
          {p.questions.length > 0 && (
            <form action={runImport} className="mt-4 space-y-3 border-t border-line pt-4">
              <input type="hidden" name="questions" value={JSON.stringify(p.questions)} /><input type="hidden" name="source" value={p.filename} />
              <div className="grid gap-x-4 sm:grid-cols-2"><div><label className="label" htmlFor="bname">Name this question bank</label><input id="bname" name="name" required defaultValue={p.filename.replace(/\.[a-z0-9]+$/i, '')} className="input" /></div>
                <div><label className="label" htmlFor="bcat">Covers</label><select id="bcat" name="category" className="input" defaultValue="mixed"><option value="product">Products</option><option value="service">Services</option><option value="mixed">Products and services</option></select></div></div>
              <button disabled={importing} className="btn-primary">{importing ? 'Importing…' : `Import ${p.questions.length} question${p.questions.length === 1 ? '' : 's'}`}</button>
              {im?.error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{im.error}</p>}{im?.ok && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{im.ok}</p>}
            </form>)}
        </section>)}
    </div>
  );
}
