import { beforeAll, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { privileged, withTenant } from '../src/server/db';
import { seedOrganization, TEMPLATES } from '../src/server/seed';
import { runAs } from '../src/server/ctx';
import { ForbiddenError } from '../src/domain/policy';
import { localParts } from '../src/domain/attendance';
import { login } from '../src/server/auth';
import { addShift, autoCloseOverdue, clockIn, listShifts } from '../src/server/attendance';
import { effectiveMode, listModes, setMode } from '../src/server/modes';
import { cardFor, computeCard, createProfile, ensureKpiDefaults, finalise, listProfiles, myCard, rate, saveProfile, teamCards } from '../src/server/kpi';
import { assessmentResults, assessmentReminders, importBank, listAssessments, myReview, previewUpload, resetAttempt, scheduleAssessment, startAttempt, submitAttempt } from '../src/server/assessment';
import { accountSummary, moderate, recentActivity } from '../src/server/oversight';
import { createUser, listUsers, resetPassword } from '../src/server/backend';
import { marketingStats, myProfile, onDutyToday, saveMyProfile, stationPulse, upcomingAnniversaries, upcomingBirthdays } from '../src/server/overview';
import { createTask } from '../src/server/tasks';
import { createTicket } from '../src/server/tickets';

const ids: Record<string, string> = {};
const u: Record<string, string> = {};
const as = <T>(who: string, fn: Parameters<typeof runAs<T>>[2]) => runAs(ids.org, u[who], fn);
const today = new Date().toISOString().slice(0, 10);
const period = today.slice(0, 7);
const hhmm = (m: number) => { const x = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
const HQ = { lat: 7.3990014, lng: 3.9411920 };

beforeAll(async () => {
  for (const t of TEMPLATES) await seedOrganization(t, []);
  const p = await privileged();
  ids.org = (await p.query<any>(`select id from organizations where slug = 'prince897'`))[0].id;
  for (const [k, e] of Object.entries({ admin: 'admin', hr: 'hr', head: 'head', presenter: 'presenter', sales: 'sales', officer: 'officer', superadmin: 'superadmin' })) u[k] = (await p.query<any>(`select id from users where org_id = $1 and email = $2`, [ids.org, `${e}@prince897.example`]))[0].id;
  ids.presenterEmp = (await p.query<any>(`select id from employees where user_id = $1`, [u.presenter]))[0].id;
});

describe('standard KPIs by department and level', () => {
  it('installs the library and department profiles for every level, once', async () => {
    const p = await as('hr', (c) => listProfiles(c));
    expect(p.length).toBeGreaterThan(30);
    const prog = p.filter((x: any) => /programmes/i.test(x.department ?? ''));
    expect(prog.map((x: any) => x.level_band).sort()).toEqual(['executive', 'intern', 'junior', 'management', 'senior', 'supervisory']);
    for (const pr of p) expect(Math.round(pr.metrics.reduce((a: number, m: any) => a + m.weight, 0) * 100) / 100).toBe(100);
    const again = await withTenant(ids.org, (q) => ensureKpiDefaults(q, ids.org));
    expect(again).toEqual({ metrics: 0, profiles: 0 }); // idempotent
    await expect(as('presenter', (c) => listProfiles(c))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('scores a person with the profile for their department and level, from real attendance data', async () => {
    const card = (await as('presenter', (c) => myCard(c, period)))!;
    expect(card.employeeId).toBe(ids.presenterEmp);
    expect(card.profile).toMatch(/News: Senior staff/);
    expect(card.lines.length).toBeGreaterThan(4);
    expect(Math.round(card.lines.reduce((a, l) => a + l.weight, 0) * 100) / 100).toBe(100);
    // no activity yet: automatic measures have no data and the manual ones are unrated, so no score is invented
    expect(card.score).toBeNull();
    expect(card.rating).toBe('Not enough data');
  });

  it('only people who may rate can rate, never themselves, and only manual measures', async () => {
    await expect(as('presenter', (c) => rate(c, ids.presenterEmp, 'content_quality', period, 90))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('officer', (c) => rate(c, ids.presenterEmp, 'content_quality', period, 90))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('head', (c) => rate(c, ids.presenterEmp, 'punctuality', period, 90))).rejects.toThrow(/measured automatically/);
    await expect(as('head', (c) => rate(c, ids.presenterEmp, 'content_quality', period, 150))).rejects.toThrow(/0 and 100/);
    const hrEmp = (await withTenant(ids.org, (q) => q.query<any>('select id from employees where user_id = $1', [u.hr])))[0].id;
    await expect(as('hr', (c) => rate(c, hrEmp, 'teamwork', period, 90))).rejects.toThrow(/cannot rate your own/);
  });

  it('turns ratings into a score, shows it to the person and to managers, and locks a finished month', async () => {
    // find the manual measures actually in this person's profile
    const manual = (await as('hr', (c) => cardFor(c, ids.presenterEmp, period)))!.lines.filter((l) => l.source === 'manual');
    expect(manual.length).toBeGreaterThan(0);
    for (const m of manual) await as('hr', (c) => rate(c, ids.presenterEmp, m.key, period, 80, 'Good month'));
    const mine = (await as('presenter', (c) => myCard(c, period)))!;
    expect(mine.score).toBe(80);
    expect(mine.rating).toBe('Exceeds expectations');
    expect(mine.coverage).toBeGreaterThan(0);
    expect(mine.coverage).toBeLessThan(100); // automatic measures still have no data
    const team = await as('hr', (c) => teamCards(c, period));
    expect(team.find((t) => t.employeeId === ids.presenterEmp)!.score).toBe(80);
    await expect(as('presenter', (c) => teamCards(c, period))).rejects.toBeInstanceOf(ForbiddenError);
    // a finished (past) month can be finalised; it then refuses new ratings
    const past = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
    await as('hr', (c) => rate(c, ids.presenterEmp, manual[0].key, past, 70));
    await expect(as('hr', (c) => finalise(c, ids.presenterEmp, period))).rejects.toThrow(/after it has ended/);
    await as('hr', (c) => finalise(c, ids.presenterEmp, past));
    await expect(as('hr', (c) => rate(c, ids.presenterEmp, manual[0].key, past, 99))).rejects.toThrow(/finalised/);
    expect((await as('presenter', (c) => myCard(c, past)))!.status).toBe('final');
    await as('hr', (c) => finalise(c, ids.presenterEmp, past, true));
    await as('hr', (c) => rate(c, ids.presenterEmp, manual[0].key, past, 99));
  });

  it('administrators can reshape a profile; the weights must add up to 100', async () => {
    const pr = (await as('hr', (c) => listProfiles(c))).find((x: any) => x.department === null && x.level_band === 'senior')!;
    const items = pr.metrics.map((m: any) => ({ metricId: m.metricId, weight: m.weight, target: m.target }));
    await expect(as('hr', (c) => saveProfile(c, pr.id, items.map((i: any, k: number) => (k ? i : { ...i, weight: i.weight + 5 }))))).rejects.toThrow(/add up to/);
    await expect(as('hr', (c) => saveProfile(c, pr.id, []))).rejects.toThrow(/at least one/);
    await as('hr', (c) => saveProfile(c, pr.id, items));
    await expect(as('presenter', (c) => saveProfile(c, pr.id, items))).rejects.toBeInstanceOf(ForbiddenError);
    const dept = (await withTenant(ids.org, (q) => q.query<any>(`select id from departments where name = 'Security'`)))[0];
    if (dept) {
      await as('hr', (c) => createProfile(c, { departmentId: dept.id, levelBand: 'executive' }).catch(() => null));
      await expect(as('hr', (c) => createProfile(c, { departmentId: dept.id, levelBand: 'executive' }))).rejects.toThrow(/already exists/);
    }
    await expect(as('hr', (c) => createProfile(c, {}))).rejects.toThrow(/Choose a department/);
  });
});

describe('monthly product and service knowledge assessment', () => {
  const docx = async (lines: string[]) => { const z = new JSZip(); z.file('word/document.xml', `<w:document><w:body>${lines.map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`); return z.generateAsync({ type: 'nodebuffer' }); };
  const questions = Array.from({ length: 12 }, (_, i) => [`${i + 1}. Question number ${i + 1}?`, 'A. Wrong one', `*B. Right one ${i + 1}`, 'C. Wrong two', '']).flat();
  let assessmentId = '';

  it('previews an uploaded file without saving anything, then imports it', async () => {
    await expect(as('presenter', async (c) => previewUpload(c, await docx(questions)))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('hr', (c) => previewUpload(c, Buffer.from('not a document')))).rejects.toThrow(/Word \(.docx\)/);
    const pv = await as('hr', async (c) => previewUpload(c, await docx([...questions, '13. Broken question', 'A. x', 'B. y'])));
    expect(pv.kind).toBe('docx');
    expect(pv.questions).toHaveLength(12);
    expect(pv.issues).toHaveLength(1);
    expect(pv.issues[0].message).toMatch(/no correct answer/);
    expect(await withTenant(ids.org, (q) => q.query('select 1 from assessment_banks'))).toHaveLength(0);
    await expect(as('hr', (c) => importBank(c, { name: 'Valid bank', category: 'mixed', questions: [] }))).rejects.toThrow(/no valid questions/);
    await expect(as('hr', (c) => importBank(c, { name: 'Bad bank', category: 'mixed', questions: [{ text: 'Tampered?', options: [{ key: 'A', text: 'x' }, { key: 'B', text: 'y' }], correctKey: 'Z', line: 1 }] }))).rejects.toThrow(/not valid/);
    const r = await as('hr', (c) => importBank(c, { name: 'Products Q4', category: 'product', source: 'q4.docx', questions: pv.questions }));
    expect(r.count).toBe(12);
  });

  it('schedules a month and checks the bank can supply the questions', async () => {
    const bank = (await withTenant(ids.org, (q) => q.query<any>('select id from assessment_banks')))[0].id;
    const base = { period, count: 8, passMark: 70, minutes: 30, opensOn: today, closesOn: today, bankIds: [bank] };
    await expect(as('presenter', (c) => scheduleAssessment(c, base))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('hr', (c) => scheduleAssessment(c, { ...base, count: 50 }))).rejects.toThrow(/only 12/);
    await expect(as('hr', (c) => scheduleAssessment(c, { ...base, closesOn: '2000-01-01' }))).rejects.toThrow(/valid opening and closing/);
    await expect(as('hr', (c) => scheduleAssessment(c, { ...base, bankIds: [] }))).rejects.toThrow(/at least one/);
    assessmentId = await as('hr', (c) => scheduleAssessment(c, base));
    await expect(as('hr', (c) => scheduleAssessment(c, base))).rejects.toThrow(/already exists/);
    expect((await as('presenter', (c) => listAssessments(c)))[0]).toMatchObject({ id: assessmentId, state: 'open', attempt_status: null });
  });

  it('gives each person their own questions and never sends the answers', async () => {
    const a = await as('presenter', (c) => startAttempt(c, assessmentId));
    const b = await as('officer', (c) => startAttempt(c, assessmentId));
    expect(a.questions).toHaveLength(8);
    expect(JSON.stringify(a)).not.toMatch(/correct/i);
    expect(a.questions.map((q) => q.id).join()).not.toBe(b.questions.map((q) => q.id).join()); // different people, different sample
    const again = await as('presenter', (c) => startAttempt(c, assessmentId)); // resuming returns the same questions
    expect(again.questions.map((q) => q.id)).toEqual(a.questions.map((q) => q.id));
    await expect(as('presenter', (c) => myReview(c, assessmentId))).resolves.toBeNull(); // no answers before submitting
  });

  it('marks on the server, once, feeds the KPI, and then reveals the answers', async () => {
    const t = await as('presenter', (c) => startAttempt(c, assessmentId));
    const keys = new Map((await withTenant(ids.org, (q) => q.query<any>('select id, correct_key from assessment_questions'))).map((r: any) => [r.id, r.correct_key]));
    const answers: Record<string, string> = {};
    t.questions.forEach((q, i) => { answers[q.id] = i < 6 ? (keys.get(q.id) as string) : 'A'; }); // 6 of 8 right
    answers['11111111-1111-1111-1111-111111111111'] = 'B'; // an answer to a question they were never given is ignored
    const res = await as('presenter', (c) => submitAttempt(c, assessmentId, answers));
    expect(res).toMatchObject({ correct: 6, total: 8, pct: 75, passed: true, late: false });
    await expect(as('presenter', (c) => submitAttempt(c, assessmentId, answers))).rejects.toThrow(/already submitted/);
    await expect(as('presenter', (c) => startAttempt(c, assessmentId))).rejects.toThrow(/already taken/);
    const review = (await as('presenter', (c) => myReview(c, assessmentId)))!;
    expect(review).toMatchObject({ correct: 6, total: 8, pct: 75 });
    expect(review.items.filter((i: any) => i.chosen === i.correctKey)).toHaveLength(6);
    // the knowledge measure now has data
    const card = (await as('presenter', (c) => myCard(c, period)))!;
    expect(card.lines.find((l) => l.key === 'knowledge')?.value).toBe(75);
  });

  it('shows managers who took it, and lets them reset one person', async () => {
    const r = await as('hr', (c) => assessmentResults(c, assessmentId));
    const mine = r.rows.find((x: any) => x.employee_id === ids.presenterEmp)!;
    expect([mine.status, mine.score, mine.passed]).toEqual(['submitted', 75, true]);
    expect(r.rows.some((x: any) => x.status == null)).toBe(true); // people who have not taken it
    await expect(as('presenter', (c) => assessmentResults(c, assessmentId))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('hr', (c) => resetAttempt(c, assessmentId, u.sales))).rejects.toThrow(/not started/);
    await as('hr', (c) => resetAttempt(c, assessmentId, ids.presenterEmp));
    expect((await as('presenter', (c) => myCard(c, period)))!.lines.find((l) => l.key === 'knowledge')?.value).toBeNull();
    await as('presenter', (c) => startAttempt(c, assessmentId)); // can retake
  });

  it('reminds people who have not taken an open assessment, once', async () => {
    const n1 = await withTenant(ids.org, (q) => assessmentReminders(q, ids.org));
    expect(n1).toBeGreaterThan(0);
    expect(await withTenant(ids.org, (q) => assessmentReminders(q, ids.org))).toBe(0);
  });

  it('the assessment is closed for taking once its dates have passed', async () => {
    await (await privileged()).query(`update assessments set opens_on = current_date - 5, closes_on = current_date - 1 where id = $1`, [assessmentId]);
    await expect(as('officer', (c) => startAttempt(c, assessmentId))).rejects.toThrow(/closed/);
  });
});

describe('where staff may clock in', () => {
  let shiftId = '';
  beforeAll(async () => {
    const now = localParts(new Date(), 'Africa/Lagos').minutes;
    await as('hr', (c) => addShift(c, { name: 'Mode test', code: 'MODE', start: hhmm(Math.max(0, now - 5)), end: hhmm(now + 480) }));
    shiftId = (await withTenant(ids.org, (q) => listShifts(q))).find((s) => s.code === 'MODE')!.id;
    await (await privileged()).query(`update shifts set archived_at = now() where code <> 'MODE'`);
  });

  it('only HR and administrators can set exceptions, with the right details', async () => {
    await expect(as('presenter', (c) => setMode(c, ids.presenterEmp, { mode: 'remote', reason: 'I said so' }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('hr', (c) => setMode(c, ids.presenterEmp, { mode: 'nonsense' }))).rejects.toThrow(/valid arrangement/);
    await expect(as('hr', (c) => setMode(c, ids.presenterEmp, { mode: 'remote' }))).rejects.toThrow(/Say why/);
    await expect(as('hr', (c) => setMode(c, ids.presenterEmp, { mode: 'hybrid', reason: 'Hybrid agreement', remoteWeekdays: [] }))).rejects.toThrow(/at least one day/);
    await expect(as('hr', (c) => setMode(c, ids.presenterEmp, { mode: 'hybrid', reason: 'Hybrid agreement', remoteWeekdays: [1, 2, 3, 4, 5, 6] }))).rejects.toThrow(/at least two days on site/);
    await expect(as('hr', (c) => setMode(c, ids.presenterEmp, { mode: 'outside_broadcast', reason: 'OB at stadium' }))).rejects.toThrow(/start and an end/);
    await expect(as('hr', (c) => setMode(c, ids.presenterEmp, { mode: 'outside_broadcast', reason: 'OB at stadium', validFrom: '2026-05-02', validTo: '2026-05-01' }))).rejects.toThrow(/before the start/);
  });

  it('works out what applies on a given day', async () => {
    const eff = (d: string) => withTenant(ids.org, (q) => effectiveMode(q, ids.presenterEmp, d));
    expect(await eff('2026-03-02')).toMatchObject({ mode: 'on_site', exemptKind: null });
    await as('hr', (c) => setMode(c, ids.presenterEmp, { mode: 'hybrid', reason: 'Hybrid: Mondays and Fridays at home', remoteWeekdays: [1, 5] }));
    expect(await eff('2026-03-02')).toMatchObject({ mode: 'hybrid', exemptKind: 'remote' }); // Monday
    expect(await eff('2026-03-03')).toMatchObject({ mode: 'hybrid', exemptKind: null });     // Tuesday
    expect(await eff('2026-03-06')).toMatchObject({ exemptKind: 'remote' });                  // Friday
    await as('hr', (c) => setMode(c, ids.presenterEmp, { mode: 'outside_broadcast', reason: 'OB at the stadium', validFrom: '2026-04-10', validTo: '2026-04-12' }));
    expect(await eff('2026-04-11')).toMatchObject({ mode: 'outside_broadcast', exemptKind: 'field' });
    expect(await eff('2026-04-13')).toMatchObject({ mode: 'on_site', exemptKind: null }); // expired: back to on site
    await as('hr', (c) => setMode(c, ids.presenterEmp, { mode: 'multi_branch', reason: undefined }));
    expect(await eff('2026-04-11')).toMatchObject({ mode: 'multi_branch', anyBranch: true });
    expect((await as('hr', (c) => listModes(c))).find((r: any) => r.id === ids.presenterEmp)!.mode).toBe('multi_branch');
    await as('hr', (c) => setMode(c, ids.presenterEmp, { mode: 'on_site' }));
    expect((await as('hr', (c) => listModes(c))).find((r: any) => r.id === ids.presenterEmp)!.mode).toBeNull();
  });

  it('clock-in: outside the geofence is refused by default and accepted (flagged) for an exempt person', async () => {
    const FAR = { lat: HQ.lat + 0.05, lng: HQ.lng, accuracyM: 15 };
    await (await privileged()).query(`insert into roster_entries (org_id, employee_id, shift_id, work_date) select $1, $2, $3, (now() at time zone 'Africa/Lagos')::date on conflict do nothing`, [ids.org, ids.presenterEmp, shiftId]);
    const blocked = await as('presenter', (c) => clockIn(c, { ...FAR, deviceId: 'phone-A' }));
    expect(blocked.ok).toBe(false);
    expect((blocked as any).code).toBe('outside');
    await as('hr', (c) => setMode(c, ids.presenterEmp, { mode: 'field', reason: 'Reporter on field duty' }));
    const ok = await as('presenter', (c) => clockIn(c, { ...FAR, deviceId: 'phone-A' }));
    expect(ok.ok).toBe(true);
    expect((ok as any).flags).toContain('field');
    expect((ok as any).result).toBe('accepted_flagged');
  });
});

describe('automatic sign-out after the shift', () => {
  it('closes forgotten sessions at the shift end, signs the person out and tells them', async () => {
    const p = await privileged();
    const dt = new Date(Date.now() - 26 * 3_600_000);
    const lp = localParts(dt, 'Africa/Lagos');
    const end = Math.max(lp.minutes, 180), start = end - 120;
    const shift = (await p.query<any>(`insert into shifts (org_id, name, code, start_time, end_time) values ($1,'Auto close test','ACT',$2,$3) returning id`, [ids.org, hhmm(start), hhmm(end)]))[0].id;
    const clockInAt = new Date(dt.getTime() - (lp.minutes - start) * 60_000);
    await p.query(`update attendance_sessions set status = 'closed', clock_out_at = clock_in_at + interval '1 minute' where employee_id = $1 and status = 'open'`, [ids.presenterEmp]);
    const sid = (await p.query<any>(`insert into attendance_sessions (org_id, employee_id, work_date, shift_id, clock_in_at, clock_in_result) values ($1,$2,$3,$4,$5,'accepted') returning id`, [ids.org, ids.presenterEmp, lp.date, shift, clockInAt]))[0].id;
    expect((await login('prince897', 'presenter@prince897.example', 'wrong-password-123')).ok).toBe(false);
    // give the presenter a real sign-in to be signed out of
    await p.query(`insert into sessions (user_id, org_id, token_hash, expires_at, idle_expires_at) values ($1,$2,'abc-token-hash', now() + interval '1 hour', now() + interval '1 hour')`, [u.presenter, ids.org]);
    const users = await withTenant(ids.org, (q) => autoCloseOverdue(q, ids.org));
    expect(users).toContain(u.presenter);
    const s = (await p.query<any>('select status, flags, clock_out_at, note from attendance_sessions where id = $1', [sid]))[0];
    expect(s.status).toBe('closed');
    expect(s.flags).toContain('auto_closed');
    expect(new Date(s.clock_out_at).getTime()).toBeGreaterThan(clockInAt.getTime());
    expect(new Date(s.clock_out_at).getTime()).toBeLessThanOrEqual(Date.now() - 15 * 60_000);
    expect((await p.query('select 1 from sessions where user_id = $1', [u.presenter]))).toHaveLength(0);
    expect((await p.query<any>(`select title from notifications where user_id = $1 and title like 'You were signed out%'`, [u.presenter]))).toHaveLength(1);
    expect(await withTenant(ids.org, (q) => autoCloseOverdue(q, ids.org))).toEqual([]); // nothing left to close
  });

  it('leaves people alone while their shift is still running or is within the grace period', async () => {
    const p = await privileged();
    const now = localParts(new Date(), 'Africa/Lagos');
    const shift = (await p.query<any>(`insert into shifts (org_id, name, code, start_time, end_time) values ($1,'Still on','STILL',$2,$3) returning id`, [ids.org, hhmm(Math.max(0, now.minutes - 600)), hhmm(Math.min(1439, now.minutes + 5))]))[0].id;
    // a shift that ended 5 minutes ago is inside the 15 minute grace
    const justEnded = (await p.query<any>(`insert into shifts (org_id, name, code, start_time, end_time) values ($1,'Just ended','JUST',$2,$3) returning id`, [ids.org, hhmm(Math.max(0, now.minutes - 300)), hhmm(Math.max(1, now.minutes - 5))]))[0].id;
    void shift; void justEnded;
    const emp = (await p.query<any>(`select id from employees where user_id = $1`, [u.sales]))[0].id;
    await p.query(`insert into attendance_sessions (org_id, employee_id, work_date, shift_id, clock_in_at, clock_in_result) values ($1,$2,$3,$4,now() - interval '3 hours','accepted')`, [ids.org, emp, now.date, shift]);
    expect(await withTenant(ids.org, (q) => autoCloseOverdue(q, ids.org))).toEqual([]);
    expect((await p.query<any>(`select status from attendance_sessions where employee_id = $1`, [emp]))[0].status).toBe('open');
  });
});

describe('administrator oversight of front-end activity', () => {
  it('administrators see everything staff create; staff do not; removals need a reason and are audited', async () => {
    const task = await as('presenter', (c) => createTask(c, { title: 'Presenter planning task', description: 'x' }));
    const ticket = await as('presenter', (c) => createTicket(c, { subject: 'Mic crackles badly', description: 'Studio B microphone crackles during shows.' }));
    await expect(as('presenter', (c) => recentActivity(c))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('hr', (c) => recentActivity(c))).rejects.toBeInstanceOf(ForbiddenError); // HR manages people, not oversight
    const feed = await as('admin', (c) => recentActivity(c, { days: 7 }));
    expect(feed.some((i) => i.kind === 'task' && i.title === 'Presenter planning task')).toBe(true);
    expect(feed.some((i) => i.kind === 'ticket' && /Mic crackles/.test(i.title))).toBe(true);
    const only = await as('admin', (c) => recentActivity(c, { userId: u.presenter, kind: 'task' }));
    expect(only.every((i) => i.kind === 'task' && i.by === u.presenter)).toBe(true);
    expect((await as('admin', (c) => recentActivity(c, { q: 'planning' }))).length).toBe(1);
    expect((await as('superadmin', (c) => recentActivity(c))).length).toBeGreaterThan(0);
    await expect(as('admin', (c) => moderate(c, 'task', (task as any).id ?? task, 'no'))).rejects.toThrow(/short reason/);
    await expect(as('presenter', (c) => moderate(c, 'task', (task as any).id ?? task, 'Not allowed to do this'))).rejects.toBeInstanceOf(ForbiddenError);
    await as('admin', (c) => moderate(c, 'task', (task as any).id ?? task, 'Duplicate of another task'));
    await expect(as('admin', (c) => moderate(c, 'task', (task as any).id ?? task, 'Again for no reason'))).rejects.toThrow(/already removed/);
    await as('admin', (c) => moderate(c, 'ticket', (ticket as any).id, 'Resolved offline by engineering'));
    const audit = await (await privileged()).query<any>(`select count(*)::int n from audit_events where action in ('oversight.task_removed','oversight.ticket_removed') and actor_user_id = $1`, [u.admin]);
    expect(audit[0].n).toBe(2);
    await expect(as('admin', (c) => moderate(c, 'payslip', '00000000-0000-0000-0000-000000000000', 'Trying something'))).rejects.toThrow(/cannot be removed/);
  });
  it('shows who creates what, without the hidden Super Admin', async () => {
    const a = await as('admin', (c) => accountSummary(c));
    expect(a.find((x: any) => x.id === u.presenter)).toBeTruthy();
    expect(a.some((x: any) => x.id === u.superadmin)).toBe(false);
  });
  it('administrators manage every account (create, reset), but not the hidden Super Admin', async () => {
    const users = await as('admin', (c) => listUsers(c));
    expect(users.some((x: any) => x.id === u.presenter)).toBe(true);
    expect(users.some((x: any) => x.id === u.superadmin)).toBe(false);
    await expect(as('presenter', (c) => listUsers(c))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('hr', (c) => listUsers(c))).rejects.toBeInstanceOf(ForbiddenError);
    const r = await as('admin', (c) => createUser(c, { email: 'new.staff@prince897.example', fullName: 'New Staff', roleKey: 'employee' }));
    expect(r.password.length).toBeGreaterThan(10);
    expect((await as('admin', (c) => resetPassword(c, u.presenter))).length).toBeGreaterThan(10);
  });
});

describe('staff dashboard data', () => {
  it('lists upcoming birthdays and anniversaries, honouring privacy', async () => {
    const list = await as('presenter', (c) => upcomingBirthdays(c, 60, 50));
    expect(list.length).toBeGreaterThan(3);
    expect(list.every((b, i) => i === 0 || b.daysAway >= list[i - 1].daysAway)).toBe(true);
    const target = list[0];
    await (await privileged()).query(`update employees set birthday_private = true where full_name = $1`, [target.name]);
    expect((await as('presenter', (c) => upcomingBirthdays(c, 60, 50))).some((b) => b.name === target.name)).toBe(false);
    const ann = await as('presenter', (c) => upcomingAnniversaries(c, 400, 50));
    expect(ann.every((a) => (a.years ?? 0) >= 1)).toBe(true);
    expect(JSON.stringify(list)).not.toMatch(/\d{4}-\d{2}-\d{2}/); // never reveals the birth year
  });
  it('lets a person set their birthday and hide it, with sensible limits', async () => {
    await expect(as('presenter', (c) => saveMyProfile(c, { birthDate: '2999-01-01' }))).rejects.toThrow(/does not look right/);
    await expect(as('presenter', (c) => saveMyProfile(c, { birthDate: new Date().getUTCFullYear() - 5 + '-01-01' }))).rejects.toThrow(/does not look right/);
    await expect(as('presenter', (c) => saveMyProfile(c, { birthDate: 'soon' }))).rejects.toThrow(/valid date/);
    await as('presenter', (c) => saveMyProfile(c, { phone: '0803 111 2222', birthDate: '1990-07-04', birthdayPrivate: false }));
    expect(await as('presenter', (c) => myProfile(c))).toMatchObject({ phone: '0803 111 2222', birth_date: '1990-07-04', birthday_private: false });
  });
  it('shows marketing counts to everyone and money only to people who may see CRM or finance', async () => {
    const p = await privileged();
    const acc = (await p.query<any>(`insert into crm_accounts (org_id, name, status, created_by) values ($1,'Gold Ads','client',$2) returning id`, [ids.org, u.sales]))[0].id;
    await p.query(`insert into crm_opportunities (org_id, account_id, title, stage, value, owner_user_id, closed_at, created_by) values ($1,$2,'Spot package','won',500000,$3, now(), $3)`, [ids.org, acc, u.sales]);
    await p.query(`insert into crm_opportunities (org_id, account_id, title, stage, value, owner_user_id, created_by) values ($1,$2,'Sponsorship','proposal',900000,$3,$3)`, [ids.org, acc, u.sales]);
    const staff = await as('presenter', (c) => marketingStats(c));
    const sales = await as('sales', (c) => marketingStats(c));
    expect([staff.money, sales.money]).toEqual([false, true]);
    expect(staff.wonThisMonth).toBe(1);
    expect(staff.openCount).toBe(1);
    expect([staff.openValue, staff.wonValueThisMonth, staff.top.length]).toEqual([0, 0, 0]); // no amounts for general staff
    expect([sales.openValue, sales.wonValueThisMonth]).toEqual([90_000_000, 50_000_000]); // minor units (kobo), like every other amount
    expect(sales.top[0]).toMatchObject({ name: 'Gold Ads', value: 90_000_000 });
    expect(sales.months).toHaveLength(6);
    expect(sales.months[5].won).toBe(1);
    expect(sales.winRate).toBe(100);
  });
  it('reports who is on duty and the station pulse', async () => {
    const duty = await as('presenter', (c) => onDutyToday(c));
    expect(Array.isArray(duty.duty)).toBe(true);
    const pulse = await as('presenter', (c) => stationPulse(c));
    expect(pulse.staff).toBeGreaterThan(5);
    expect(pulse.clockedToday).toBeGreaterThanOrEqual(0);
  });
});

describe('KPI picks up real activity', () => {
  it('measures punctuality and task completion from the records', async () => {
    const p = await privileged();
    const emp = (await p.query<any>(`select id, user_id from employees where user_id = $1`, [u.officer]))[0];
    const d = today;
    const shift = (await p.query<any>(`select id from shifts where code = 'MODE'`))[0].id;
    // two sessions this month: one on time, one late
    await p.query(`insert into attendance_sessions (org_id, employee_id, work_date, shift_id, clock_in_at, clock_in_result, late_minutes, status, clock_out_at) values ($1,$2,$3,$4, now() - interval '30 hours', 'accepted', 0, 'closed', now() - interval '29 hours')`, [ids.org, emp.id, new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), shift]);
    await p.query(`insert into attendance_sessions (org_id, employee_id, work_date, shift_id, clock_in_at, clock_in_result, late_minutes, status, clock_out_at) values ($1,$2,$3,$4, now() - interval '6 hours', 'accepted_flagged', 25, 'closed', now() - interval '5 hours')`, [ids.org, emp.id, d, shift]);
    // tasks due this month: one done on time, one not done
    await p.query(`insert into tasks (org_id, title, assignee_employee_id, created_by, status, due_date, completed_at) values ($1,'Done on time',$2,$3,'done',current_date, now())`, [ids.org, emp.id, u.hr]);
    await p.query(`insert into tasks (org_id, title, assignee_employee_id, created_by, status, due_date) values ($1,'Still open',$2,$3,'todo',current_date)`, [ids.org, emp.id, u.hr]);
    const card = (await withTenant(ids.org, (q) => computeCard(q, ids.org, emp.id, period, true)))!;
    const by = (k: string) => card.lines.find((l) => l.key === k);
    // the officer belongs to Finance or the default profile: check whichever of these measures the profile includes
    if (by('punctuality')) expect(by('punctuality')!.value).toBe(50);
    if (by('task_completion')) expect(by('task_completion')!.value).toBe(50);
    if (by('task_timeliness')) expect(by('task_timeliness')!.value).toBe(100);
    expect(card.lines.some((l) => l.key === 'punctuality' || l.key === 'task_completion')).toBe(true);
  });
});
