import { page, mutate, field, optional } from '@/server/session';
import { assignTraining, complianceGaps, createCourse, listCourses, listRecords, recordResult } from '@/server/training';
import { archiveCourse, updateCourse } from '@/server/edits';
import { need } from '@/server/ctx';
import { ActionForm, Field, Select } from '@/components/forms';

export const metadata = { title: 'Manage training' };
export const dynamic = 'force-dynamic';

async function course(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/training/manage'], async (c) => { await createCourse(c, { name: field(f, 'name'), description: field(f, 'description'), mandatory: field(f, 'mandatory') === 'on', validMonths: field(f, 'months') ? Number(field(f, 'months')) : null }); return 'Course added.'; });
}
async function courseEdit(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/training/manage'], async (c) => { await updateCourse(c, field(f, 'id'), { name: field(f, 'name'), description: field(f, 'description'), mandatory: field(f, 'mandatory') === 'on', validMonths: field(f, 'months') ? Number(field(f, 'months')) : null }); return 'Course updated.'; });
}
async function courseArchive(_p: unknown, f: FormData) { 'use server'; return mutate(['/training/manage'], async (c) => { await archiveCourse(c, field(f, 'id')); return 'Course archived.'; }); }
async function assign(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/training/manage'], async (c) => { const n = await assignTraining(c, { courseId: field(f, 'course'), employeeIds: f.getAll('people').map(String), dueOn: optional(f, 'due') ?? undefined }); return `Assigned to ${n} ${n === 1 ? 'person' : 'people'} (anyone with the course already open was skipped).`; });
}
async function result(_p: unknown, f: FormData) {
  'use server';
  return mutate(['/training/manage'], async (c) => { await recordResult(c, field(f, 'record'), { passed: field(f, 'intent') !== 'fail', completedOn: field(f, 'on'), score: field(f, 'score'), certificateRef: field(f, 'cert') }); return 'Result recorded.'; });
}

export default async function Manage() {
  return page(async (p) => {
    p.requireFeature('training');
    need(p.ctx, 'training:manage');
    const [courses, records, gaps, people] = await Promise.all([listCourses(p.ctx.q), listRecords(p.ctx), complianceGaps(p.ctx), p.ctx.q.query<any>(`select id, full_name, employee_no from employees where status <> 'exited' order by full_name`)]);
    const open = records.filter((r: any) => r.status === 'assigned');
    const today = new Date().toISOString().slice(0, 10);
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Training &amp; certification</h1>
        <section className="card" aria-labelledby="gaps"><h2 id="gaps" className="font-semibold">Mandatory training gaps <span className="text-muted">({gaps.length})</span></h2>
          {gaps.length === 0 ? <p className="mt-2 text-sm text-muted">Everyone holds a current certificate for every mandatory course.</p> : <ul className="mt-2 max-h-64 divide-y divide-line overflow-auto text-sm">{gaps.map((g: any) => <li key={g.course_id + g.employee_id} className="flex justify-between py-1.5"><span>{g.full_name} <span className="text-muted">({g.employee_no})</span></span><span>{g.course}{g.assigned ? ' · assigned' : ''}</span></li>)}</ul>}</section>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card"><h2 className="font-semibold">New course</h2><ActionForm action={course as any} submit="Add course" className="mt-3"><Field label="Name" name="name" required placeholder="e.g. Fire safety" /><Field label="Description" name="description" /><div className="grid gap-x-4 sm:grid-cols-2"><Field label="Valid for (months)" name="months" placeholder="blank = never expires" /></div><label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" name="mandatory" /> Mandatory for everyone</label></ActionForm></section>
          <section className="card"><h2 className="font-semibold">Assign a course</h2><ActionForm action={assign as any} submit="Assign" className="mt-3"><Select label="Course" name="course" required allowEmpty={false} options={courses.map((c: any) => ({ value: c.id, label: c.name }))} /><Field label="Due date" name="due" type="date" />
            <div className="mb-1"><label className="label" htmlFor="people">People (hold Ctrl/Cmd to choose several)</label><select id="people" name="people" multiple size={6} className="input" required>{people.map((e: any) => <option key={e.id} value={e.id}>{e.full_name} ({e.employee_no})</option>)}</select></div></ActionForm></section>
        </div>
        <section className="card"><h2 className="font-semibold">Courses <span className="text-muted">({courses.length})</span></h2>
          {courses.length === 0 ? <p className="mt-2 text-sm text-muted">No courses yet. Add one above.</p> : <ul className="mt-2 divide-y divide-line text-sm">{courses.map((k: any) => (
            <li key={k.id} className="py-2"><div className="flex flex-wrap items-center justify-between gap-2"><span><strong>{k.name}</strong>{k.mandatory && <span className="badge ml-2">Mandatory</span>}<span className="ml-2 text-muted">{k.valid_months ? `valid ${k.valid_months} months` : 'never expires'}</span></span></div>
              <details className="mt-1"><summary className="cursor-pointer text-xs text-muted underline">Edit or archive</summary>
                <ActionForm action={courseEdit as any} submit="Save course" className="mt-2"><input type="hidden" name="id" value={k.id} /><div className="grid gap-x-3 sm:grid-cols-3"><Field label="Name" name="name" required defaultValue={k.name} /><Field label="Description" name="description" defaultValue={k.description ?? ''} /><Field label="Valid for (months)" name="months" defaultValue={k.valid_months ? String(k.valid_months) : ''} /></div><label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" name="mandatory" defaultChecked={!!k.mandatory} className="h-5 w-5" /> Mandatory for everyone</label></ActionForm>
                <ActionForm action={courseArchive as any} submit="Archive course" tone="danger" confirm="Archive this course?" className="mt-2"><input type="hidden" name="id" value={k.id} /></ActionForm></details></li>))}</ul>}</section>
        <section className="card"><h2 className="font-semibold">Awaiting a result <span className="text-muted">({open.length})</span></h2>
          {open.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing is waiting for a result.</p> : <ul className="mt-2 divide-y divide-line">{open.map((r: any) => (
            <li key={r.id} className="py-3"><p className="text-sm"><strong>{r.full_name}</strong> · {r.course}{r.due_on && <span className={r.due_on < today ? 'ml-2 font-semibold text-red-700 dark:text-red-400' : 'ml-2 text-muted'}>due {r.due_on}</span>}</p>
              <ActionForm action={result as any} submit="" className="!mt-1" buttons={[{ label: 'Passed', value: 'pass' }, { label: 'Not passed', value: 'fail', tone: 'ghost' }]}><input type="hidden" name="record" value={r.id} /><div className="grid gap-x-3 sm:grid-cols-3"><Field label="Completed on" name="on" type="date" required defaultValue={today} /><Field label="Score % (optional)" name="score" /><Field label="Certificate no. (optional)" name="cert" /></div></ActionForm></li>))}</ul>}</section>
        <section className="card overflow-x-auto"><h2 className="font-semibold">All records</h2><table className="mt-2 w-full min-w-[40rem]"><thead><tr className="border-b border-line"><th className="th">Person</th><th className="th">Course</th><th className="th">State</th><th className="th">Completed</th><th className="th">Valid until</th></tr></thead><tbody>{records.map((r: any) => <tr key={r.id} className="border-b border-line last:border-0"><td className="td">{r.full_name}</td><td className="td">{r.course}</td><td className="td">{r.state}</td><td className="td">{r.completed_on ?? '–'}</td><td className="td">{r.expires_on ?? '–'}</td></tr>)}</tbody></table></section>
      </div>
    );
  });
}
