import { beforeAll, describe, expect, it } from 'vitest';
import { privileged, withTenant } from '../src/server/db';
import { seedOrganization, TEMPLATES } from '../src/server/seed';
import { runAs } from '../src/server/ctx';
import { ForbiddenError } from '../src/domain/policy';
import { mapsUrl, parseCoordinates } from '../src/domain/geo';
import { listBranches, saveBranch } from '../src/server/branches';
import { archiveCourse, archiveLeaveType, archiveShift, renameStructure, updateCourse, updateCrmAccount, updateEmployee, updateLeaveType, updateShift } from '../src/server/edits';
import { activeAnnouncements, postAnnouncement, updateAnnouncement } from '../src/server/calendar';
import { createCourse } from '../src/server/training';
import { createAccount } from '../src/server/crm';
import { addShift, listLeaveTypes, listShifts } from '../src/server/attendance';

describe('coordinates from Google Maps', () => {
  it('reads the common pasted formats', () => {
    expect(parseCoordinates('7.3990014, 3.9411920')).toEqual({ lat: 7.399001, lng: 3.941192 });
    expect(parseCoordinates('  7.3990014 3.9411920 ')).toEqual({ lat: 7.399001, lng: 3.941192 });
    expect(parseCoordinates('-33.8688, 151.2093')).toEqual({ lat: -33.8688, lng: 151.2093 });
    expect(parseCoordinates('https://www.google.com/maps/place/Glass+House/@7.3990014,3.9411920,17z/data=!3m1')).toEqual({ lat: 7.399001, lng: 3.941192 });
    expect(parseCoordinates('https://maps.google.com/maps/dir/!3d6.5244!4d3.3792')).toEqual({ lat: 6.5244, lng: 3.3792 });
  });
  it('explains what is wrong', () => {
    expect(parseCoordinates('')).toEqual({ error: expect.stringContaining('Paste the coordinates') });
    expect(parseCoordinates('hello')).toEqual({ error: expect.stringContaining('Could not find two numbers') });
    expect(parseCoordinates('95.1, 3.9')).toEqual({ error: expect.stringContaining('latitude') });
    expect(parseCoordinates('7.1, 200.5')).toEqual({ error: expect.stringContaining('longitude') });
    expect(mapsUrl(7.4, 3.9)).toBe('https://www.google.com/maps?q=7.4,3.9');
  });
});

const ids: Record<string, string> = {};
const u: Record<string, string> = {};
const as = <T>(who: string, fn: Parameters<typeof runAs<T>>[2]) => runAs(ids.org, u[who], fn);

beforeAll(async () => {
  for (const t of TEMPLATES) await seedOrganization(t, []);
  const p = await privileged();
  ids.org = (await p.query<any>(`select id from organizations where slug = 'prince897'`))[0].id;
  for (const [k, e] of Object.entries({ admin: 'admin', hr: 'hr', sales: 'sales', presenter: 'presenter' })) u[k] = (await p.query<any>(`select id from users where org_id = $1 and email = $2`, [ids.org, `${e}@prince897.example`]))[0].id;
});

describe('branches with Google coordinates', () => {
  it('only structure managers can edit; coordinates create and update a geofenced workplace', async () => {
    await expect(as('presenter', (c) => listBranches(c))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('presenter', (c) => saveBranch(c, { name: 'X Branch' }))).rejects.toBeInstanceOf(ForbiddenError);
    const id = await as('admin', (c) => saveBranch(c, { name: 'Lagos Studio', code: 'LOS', region: 'Lagos', address: 'Ikeja', coordinates: '6.6018, 3.3515', radiusM: 200 }));
    const row = (await as('admin', (c) => listBranches(c))).find((b: any) => b.id === id)!;
    expect([row.lat, row.lng, row.radius, row.map]).toEqual([6.6018, 3.3515, 200, 'https://www.google.com/maps?q=6.6018,3.3515']);
    const wp = await withTenant(ids.org, (q) => q.query<any>(`select name, kind, latitude, radius_m from workplaces where branch_id = $1`, [id]));
    expect(wp).toHaveLength(1);
    expect([wp[0].kind, Number(wp[0].latitude), wp[0].radius_m]).toEqual(['branch', 6.6018, 200]);
    // editing moves the same workplace, it does not add another
    await as('admin', (c) => saveBranch(c, { id, name: 'Lagos Studio', coordinates: 'https://www.google.com/maps/@6.61,3.36,15z', radiusM: 120 }));
    const wp2 = await withTenant(ids.org, (q) => q.query<any>(`select latitude, radius_m from workplaces where branch_id = $1`, [id]));
    expect(wp2).toHaveLength(1);
    expect([Number(wp2[0].latitude), wp2[0].radius_m]).toEqual([6.61, 120]);
  });
  it('validates input and keeps one headquarters', async () => {
    await expect(as('admin', (c) => saveBranch(c, { name: 'A' }))).rejects.toThrow(/2 and 80/);
    await expect(as('admin', (c) => saveBranch(c, { name: 'Bad Coords', coordinates: '999, 999' }))).rejects.toThrow(/latitude/);
    await expect(as('admin', (c) => saveBranch(c, { name: 'Bad Radius', radiusM: 5 }))).rejects.toThrow(/radius/);
    await expect(as('admin', (c) => saveBranch(c, { name: 'lagos studio' }))).rejects.toThrow(/already exists/);
    const a = await as('admin', (c) => saveBranch(c, { name: 'North HQ', coordinates: '9.07, 7.40', headquarters: true }));
    const b = await as('admin', (c) => saveBranch(c, { name: 'South HQ', coordinates: '4.82, 7.03', headquarters: true }));
    const list = await as('admin', (c) => listBranches(c));
    expect(list.find((x: any) => x.id === a)!.is_headquarters).toBe(false);
    expect(list.find((x: any) => x.id === b)!.is_headquarters).toBe(true);
  });
  it('the demo headquarters carries the supplied Google coordinates', async () => {
    const hq = (await as('admin', (c) => listBranches(c))).find((b: any) => b.name === 'Headquarters')!;
    expect([hq.lat, hq.lng]).toEqual([7.399001, 3.941192]);
  });
});

describe('announcements: edit and rotation feed', () => {
  it('can be edited, re-audienced and expired', async () => {
    await as('hr', (c) => postAnnouncement(c, { title: 'Staff meeting', body: 'Friday 10am', roles: [] }));
    const a = (await as('hr', (c) => activeAnnouncements(c))).find((x: any) => x.title === 'Staff meeting')!;
    await expect(as('presenter', (c) => updateAnnouncement(c, a.id, { title: 'x y', body: 'z', roles: [] }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('hr', (c) => updateAnnouncement(c, a.id, { title: 'x', body: 'z', roles: [] }))).rejects.toThrow(/title/);
    await expect(as('hr', (c) => updateAnnouncement(c, a.id, { title: 'Staff meeting', body: 'z', roles: [], startsOn: '2030-01-02', expiresOn: '2030-01-01' }))).rejects.toThrow(/before the start/);
    await as('hr', (c) => updateAnnouncement(c, a.id, { title: 'Staff meeting (moved)', body: 'Friday 11am', roles: ['hr_manager'], pinned: true }));
    const mine = await as('hr', (c) => activeAnnouncements(c));
    expect(mine[0]).toMatchObject({ title: 'Staff meeting (moved)', pinned: true });
    expect((await as('presenter', (c) => activeAnnouncements(c))).some((x: any) => x.id === a.id)).toBe(false); // narrowed to managers
    await as('hr', (c) => updateAnnouncement(c, a.id, { title: 'Staff meeting (moved)', body: 'Friday 11am', roles: [], expiresOn: '2000-01-01', startsOn: '1999-01-01' }));
    expect((await as('hr', (c) => activeAnnouncements(c))).some((x: any) => x.id === a.id)).toBe(false); // expired
  });
});

describe('edit buttons for records that could only be added', () => {
  it('structure rename, employee profile, shifts, leave types, courses, CRM accounts', async () => {
    const dep = (await withTenant(ids.org, (q) => q.query<any>(`select id, name from departments where archived_at is null order by name limit 2`)));
    await expect(as('presenter', (c) => renameStructure(c, 'department', dep[0].id, { name: 'Hacked' }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('admin', (c) => renameStructure(c, 'department', dep[0].id, { name: dep[1].name }))).rejects.toThrow(/already exists/);
    await as('admin', (c) => renameStructure(c, 'department', dep[0].id, { name: 'Programmes & Shows', code: 'PRG' }));
    expect((await withTenant(ids.org, (q) => q.query<any>('select name, code from departments where id = $1', [dep[0].id])))[0]).toEqual({ name: 'Programmes & Shows', code: 'PRG' });

    const emp = (await withTenant(ids.org, (q) => q.query<any>(`select id from employees where user_id = $1`, [u.presenter])))[0].id;
    await expect(as('presenter', (c) => updateEmployee(c, emp, { fullName: 'Self Edit' }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('hr', (c) => updateEmployee(c, emp, { fullName: 'A', status: 'active' }))).rejects.toThrow(/full name/);
    await expect(as('hr', (c) => updateEmployee(c, emp, { fullName: 'Okay Name', status: 'exited' }))).rejects.toThrow(/valid status/);
    await as('hr', (c) => updateEmployee(c, emp, { fullName: 'Morning Presenter', phone: '0803 000 1111', employmentType: 'contract', status: 'on_leave' }));
    expect((await withTenant(ids.org, (q) => q.query<any>('select full_name, phone, employment_type, status from employees where id = $1', [emp])))[0]).toEqual({ full_name: 'Morning Presenter', phone: '0803 000 1111', employment_type: 'contract', status: 'on_leave' });

    await as('hr', (c) => addShift(c, { name: 'Edit Me', code: 'EDT', start: '08:00', end: '12:00' }));
    const sh = (await withTenant(ids.org, (q) => listShifts(q))).find((s) => s.code === 'EDT')!;
    await expect(as('hr', (c) => updateShift(c, sh.id, { name: 'Edit Me', start: '09:00', end: '09:00' }))).rejects.toThrow(/identical/);
    await as('hr', (c) => updateShift(c, sh.id, { name: 'Edited', start: '09:00', end: '13:30', graceMin: 5, earlyMin: 30 }));
    expect((await withTenant(ids.org, (q) => listShifts(q))).find((s) => s.id === sh.id)).toMatchObject({ name: 'Edited', start: '09:00', end: '13:30', graceMin: 5, earlyMin: 30 });
    await as('hr', (c) => archiveShift(c, sh.id));
    expect((await withTenant(ids.org, (q) => listShifts(q))).some((s) => s.id === sh.id)).toBe(false);

    const lt = (await withTenant(ids.org, (q) => listLeaveTypes(q))).find((t: any) => t.name === 'Study leave')!;
    await as('hr', (c) => updateLeaveType(c, lt.id, { name: 'Study leave', annualDays: 10, paid: true, carryOverMax: 3, prorate: false }));
    expect((await withTenant(ids.org, (q) => listLeaveTypes(q))).find((t: any) => t.id === lt.id)).toMatchObject({ annual_days: '10.0', paid: true, carry_over_max: '3.0', prorate: false });
    await expect(as('hr', (c) => updateLeaveType(c, lt.id, { name: 'Annual leave', annualDays: 1, paid: true }))).rejects.toThrow(/already exists/);
    await as('hr', (c) => archiveLeaveType(c, lt.id));

    const course = await as('hr', (c) => createCourse(c, { name: 'Fire safety', mandatory: false }));
    await as('hr', (c) => updateCourse(c, course, { name: 'Fire & first aid', mandatory: true, validMonths: 12 }));
    expect((await withTenant(ids.org, (q) => q.query<any>('select name, mandatory, valid_months from training_courses where id = $1', [course])))[0]).toEqual({ name: 'Fire & first aid', mandatory: true, valid_months: 12 });
    await expect(as('presenter', (c) => archiveCourse(c, course))).rejects.toBeInstanceOf(ForbiddenError);
    await as('hr', (c) => archiveCourse(c, course));

    const acc = await as('sales', (c) => createAccount(c, { name: 'Acme Ads', status: 'lead' }));
    await as('sales', (c) => updateCrmAccount(c, acc, { name: 'Acme Advertising', status: 'client', phone: '0803', email: 'Ads@Acme.example' }));
    expect((await withTenant(ids.org, (q) => q.query<any>('select name, status, email from crm_accounts where id = $1', [acc])))[0]).toEqual({ name: 'Acme Advertising', status: 'client', email: 'ads@acme.example' });
    await expect(as('sales', (c) => updateCrmAccount(c, acc, { name: 'Acme Advertising', email: 'nope' }))).rejects.toThrow(/valid email/);
    await expect(as('presenter', (c) => updateCrmAccount(c, acc, { name: 'Mine now' }))).rejects.toBeInstanceOf(ForbiddenError);
  });
});
