import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { page, mutate, field } from '@/server/session';
import { bankQuestions, deleteQuestion, importBank, listAssessments, listBanks, previewUpload, scheduleAssessment, setBankActive } from '@/server/assessment';
import { need, runAs, UserError } from '@/server/ctx';
import { resolveSession, SESSION_COOKIE } from '@/server/auth';
import { ForbiddenError } from '@/domain/policy';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ActionForm, Field } from '@/components/forms';
import { Empty } from '@/components/ui';
import { BankUploader, type UploadState } from './uploader';

export const metadata = { title: 'Manage assessments' };
export const dynamic = 'force-dynamic';

async function who() {
  const s = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) redirect('/login');
  return s;
}
const fail = (e: unknown): UploadState => {
  if (e instanceof UserError) return { error: e.message };
  if (e instanceof ForbiddenError) return { error: 'You are not allowed to do this.' };
  console.error(e); return { error: 'Something went wrong. Nothing was changed.' };
};

async function preview(_p: UploadState, f: FormData): Promise<UploadState> {
  'use server';
  const s = await who();
  const file = f.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a file first.' };
  try {
    const r = await runAs(s.org_id, s.user_id, async (c) => previewUpload(c, Buffer.from(await file.arrayBuffer())));
    return { preview: { filename: file.name.slice(0, 120), kind: r.kind, questions: r.questions, issues: r.issues } };
  } catch (e) { return fail(e); }
}
async function doImport(_p: UploadState, f: FormData): Promise<UploadState> {
  'use server';
  const s = await who();
  let questions: any;
  try { questions = JSON.parse(String(f.get('questions') ?? '[]')); } catch { return { error: 'The question list could not be read. Read the file again.' }; }
  try {
    const r = await runAs(s.org_id, s.user_id, (c) => importBank(c, { name: field(f, 'name'), category: field(f, 'category'), source: field(f, 'source'), questions }));
    revalidatePath('/assessment/manage');
    return { ok: `Imported ${r.count} questions. Schedule a monthly assessment below to use them.` };
  } catch (e) { return fail(e); }
}
async function schedule(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/assessment/manage', '/assessment', '/dashboard'], async (c) => { await scheduleAssessment(c, { period: field(f, 'period'), title: field(f, 'title'), count: Number(field(f, 'count')), passMark: Number(field(f, 'pass')), minutes: Number(field(f, 'minutes')), opensOn: field(f, 'opens'), closesOn: field(f, 'closes'), bankIds: f.getAll('banks').map(String) }); return 'Scheduled. Staff are notified when it opens.'; });
}
async function toggle(_p: unknown, f: FormData) { 'use server'; return mutate(['/assessment/manage'], async (c) => { const on = field(f, 'intent') === 'on'; await setBankActive(c, field(f, 'id'), on); return on ? 'Bank switched on.' : 'Bank switched off: it will not be used for new assessments.'; }); }
async function removeQ(_p: unknown, f: FormData) { 'use server'; return mutate(['/assessment/manage'], async (c) => { await deleteQuestion(c, field(f, 'id')); return 'Question removed.'; }); }

export default async function Manage({ searchParams }: { searchParams: Promise<{ bank?: string }> }) {
  const sp = await searchParams;
  return page(async (p) => {
    p.requireFeature('kpi');
    need(p.ctx, 'assessment:manage');
    const [banks, ass] = await Promise.all([listBanks(p.ctx), listAssessments(p.ctx)]);
    const open = sp.bank && /^[0-9a-f-]{36}$/i.test(sp.bank) ? await bankQuestions(p.ctx, sp.bank) : [];
    const today = new Date().toISOString().slice(0, 10);
    const monthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
    return (
      <div className="min-w-0 space-y-6">
        <header><h1 className="text-2xl font-bold">Product &amp; service knowledge assessments</h1><p className="text-sm text-muted">Upload questions, schedule the monthly assessment, and follow the results. Each person&apos;s score feeds their KPI.</p></header>
        <section className="card"><h2 className="font-semibold">1. Upload questions</h2><p className="mt-1 text-sm text-muted">Word, PDF or PowerPoint. The correct answer has <strong>*</strong> in front. You see a preview before anything is saved.</p><div className="mt-3"><BankUploader preview={preview} doImport={doImport} /></div></section>

        <section className="card"><h2 className="font-semibold">2. Question banks</h2>
          {banks.length === 0 ? <div className="mt-2"><Empty title="No question banks yet" text="Upload a file above to create the first one." /></div> : (
            <ul className="mt-3 divide-y divide-line">{banks.map((b: any) => (
              <li key={b.id} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><p className="font-medium">{b.name} {!b.active && <span className="badge ml-1">Off</span>}</p><p className="text-xs text-muted">{b.category} · {b.question_count} questions{b.source_file ? ` · from ${b.source_file}` : ''}</p></div>
                <div className="flex items-center gap-2"><Link className="btn-ghost" href={`/assessment/manage?bank=${b.id}#questions`}>View questions</Link>
                  <ActionForm action={toggle as any} submit="" tone="ghost" className="!mt-0" buttons={[b.active ? { label: 'Switch off', value: 'off', tone: 'ghost' as const } : { label: 'Switch on', value: 'on', tone: 'ghost' as const }]}><input type="hidden" name="id" value={b.id} /></ActionForm></div></div></li>))}</ul>)}
          {open.length > 0 && <div id="questions" className="mt-4 rounded-xl border border-line p-3"><h3 className="font-medium">Questions in this bank (administrators only: answers are shown)</h3><ol className="mt-2 max-h-96 space-y-3 overflow-auto text-sm">{open.map((q: any) => (
            <li key={q.id}><div className="flex items-start justify-between gap-2"><p className="font-medium">{q.position}. {q.text}</p><ActionForm action={removeQ as any} submit="Remove" tone="ghost" confirm="Remove this question?" className="!mt-0"><input type="hidden" name="id" value={q.id} /></ActionForm></div>
              <ul className="ml-4">{(q.options as any[]).map((o) => <li key={o.key} className={o.key === q.correct_key ? 'font-semibold text-emerald-700 dark:text-emerald-400' : ''}>{o.key}. {o.text}{o.key === q.correct_key ? ' ✓' : ''}</li>)}</ul></li>))}</ol></div>}
        </section>

        <section className="card"><h2 className="font-semibold">3. Schedule the monthly assessment</h2>
          <ActionForm action={schedule as any} submit="Schedule" className="mt-3"><div className="grid gap-x-4 sm:grid-cols-3">
            <Field label="Counts for month" name="period" type="month" required defaultValue={today.slice(0, 7)} /><Field label="Title (optional)" name="title" /><Field label="Questions per person" name="count" type="number" required defaultValue="20" />
            <Field label="Pass mark %" name="pass" type="number" required defaultValue="70" /><Field label="Minutes allowed" name="minutes" type="number" required defaultValue="30" /><span />
            <Field label="Opens on" name="opens" type="date" required defaultValue={today} /><Field label="Closes on" name="closes" type="date" required defaultValue={monthEnd} /></div>
            <fieldset className="mt-1"><legend className="label">Question banks to draw from</legend>{banks.filter((b: any) => b.active).length === 0 ? <p className="text-sm text-muted">No active banks yet.</p> : <div className="flex flex-wrap gap-4 text-sm">{banks.filter((b: any) => b.active).map((b: any) => <label key={b.id} className="flex items-center gap-2"><input type="checkbox" name="banks" value={b.id} defaultChecked className="h-5 w-5" /> {b.name} ({b.question_count})</label>)}</div>}</fieldset></ActionForm></section>

        <section className="card"><h2 className="font-semibold">4. Scheduled assessments and results</h2>
          {ass.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing scheduled yet.</p> : <ul className="mt-2 divide-y divide-line text-sm">{ass.map((a: any) => <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><strong>{a.title}</strong><span className="text-muted"> · {a.opens_on} to {a.closes_on} · {a.state}</span></span><Link className="underline" href={`/assessment/results/${a.id}`}>Results</Link></li>)}</ul>}</section>
      </div>
    );
  });
}
