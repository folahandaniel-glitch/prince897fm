import { beforeAll, describe, expect, it } from 'vitest';
import { privileged, withTenant } from '../src/server/db';
import { seedOrganization, TEMPLATES } from '../src/server/seed';
import { runAs } from '../src/server/ctx';
import { ForbiddenError } from '../src/domain/policy';
import { assignRoster } from '../src/server/attendance';
import { cancelSwap, colleagueReply, colleagues, decideSwap, mySwaps, myShifts, requestSwap, swapQueue } from '../src/server/swaps';
import { rotateSecrets } from '../src/server/rotate';
import { decryptSecret, encryptSecret, encryptWith, decryptWith } from '../src/server/mfa';
import { seal, unseal } from '../src/server/sensitive';

const ids: Record<string, string> = {};
const u: Record<string, string> = {};
const as = <T>(who: string, fn: Parameters<typeof runAs<T>>[2]) => runAs(ids.org, u[who], fn);
const addDaysIso = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  const lines: string[] = [];
  for (const t of TEMPLATES) await seedOrganization(t, lines);
  const p = await privileged();
  ids.org = (await p.query<any>(`select id from organizations where slug = 'prince897'`))[0].id;
  for (const [k, e] of Object.entries({ hr: 'hr', presenter: 'presenter', officer: 'officer', head: 'head' })) u[k] = (await p.query<any>(`select u.id from users u join organizations o on o.id=u.org_id where o.slug='prince897' and u.email=$1`, [`${e}@prince897.example`]))[0].id;
  ids.presenterEmp = (await p.query<any>(`select id from employees where user_id = $1`, [u.presenter]))[0].id;
  const a = (await p.query<any>(`select department_id, branch_id, position_id from assignments where employee_id = $1 and superseded_at is null`, [ids.presenterEmp]))[0];
  // a colleague in the same department
  const role = (await p.query<any>(`select id from roles where org_id = $1 and key = 'employee'`, [ids.org]))[0].id;
  u.mate = (await p.query<any>(`insert into users (org_id, email, password_hash) values ($1,'mate@prince897.example','x') returning id`, [ids.org]))[0].id;
  await p.query('insert into user_roles (org_id, user_id, role_id) values ($1,$2,$3)', [ids.org, u.mate, role]);
  ids.mateEmp = (await p.query<any>(`insert into employees (org_id, user_id, employee_no, full_name, email, joined_on) values ($1,$2,'EMP-9001','Mate Colleague','mate@prince897.example', current_date - 400) returning id`, [ids.org, u.mate]))[0].id;
  await p.query(`insert into assignments (org_id, employee_id, department_id, branch_id, position_id, valid_from, reason) values ($1,$2,$3,$4,$5, current_date - 400, 'x')`, [ids.org, ids.mateEmp, a.department_id, a.branch_id, a.position_id]);
  ids.shift = (await p.query<any>(`select id from shifts where org_id = $1 and archived_at is null order by start_time limit 1`, [ids.org]))[0].id;
});

const publish = async (emp: string, date: string) => { const r = await as('hr', (c) => assignRoster(c, { employeeId: emp, shiftId: ids.shift, dates: [date] })); expect(r.created).toEqual([date]); };

describe('shift cover requests', () => {
  const d1 = addDaysIso(today, 10), d2 = addDaysIso(today, 11), d3 = addDaysIso(today, 12);
  it('lists my shifts and only same-department colleagues', async () => {
    await publish(ids.presenterEmp, d1);
    const mine = await as('presenter', (c) => myShifts(c));
    expect(mine.map((s: any) => s.d)).toContain(d1);
    const mates = await as('presenter', (c) => colleagues(c));
    expect(mates.map((m: any) => m.full_name)).toContain('Mate Colleague');
    expect(mates.map((m: any) => m.id)).not.toContain(ids.presenterEmp);
  });

  it('goes colleague -> manager and moves the shift on approval', async () => {
    const entry = (await as('presenter', (c) => myShifts(c))).find((s: any) => s.d === d1)!.id;
    const id = await as('presenter', (c) => requestSwap(c, { entryId: entry, targetEmployeeId: ids.mateEmp, reason: 'Family event' }));
    await expect(as('presenter', (c) => requestSwap(c, { entryId: entry, targetEmployeeId: ids.mateEmp }))).rejects.toThrow(/already has an open/);
    // the manager cannot decide before the colleague agrees
    await expect(as('hr', (c) => decideSwap(c, id, true, ''))).rejects.toThrow(/not waiting for a manager/);
    // only the named colleague can reply
    await expect(as('presenter', (c) => colleagueReply(c, id, true))).rejects.toThrow(/not sent to you/);
    await as('mate', (c) => colleagueReply(c, id, true));
    expect((await as('hr', (c) => swapQueue(c))).map((r: any) => r.id)).toContain(id);
    await expect(as('presenter', (c) => swapQueue(c))).rejects.toBeInstanceOf(ForbiddenError);
    await as('hr', (c) => decideSwap(c, id, true, 'ok'));
    const rows = await withTenant(ids.org, (q) => q.query<any>(`select employee_id, status from roster_entries where work_date = $1 and superseded_at is null and status = 'published'`, [d1]));
    expect(rows.map((r: any) => r.employee_id)).toEqual([ids.mateEmp]);
    expect((await as('presenter', (c) => mySwaps(c)))[0].status).toBe('approved');
    expect((await as('mate', (c) => myShifts(c))).map((s: any) => s.d)).toContain(d1);
  });

  it('refuses approval when the colleague would clash, and keeps the original shift', async () => {
    await publish(ids.presenterEmp, d2);
    await publish(ids.mateEmp, d2); // the same shift is already theirs that day
    const entry = (await as('presenter', (c) => myShifts(c))).find((s: any) => s.d === d2)!.id;
    const id = await as('presenter', (c) => requestSwap(c, { entryId: entry, targetEmployeeId: ids.mateEmp }));
    await as('mate', (c) => colleagueReply(c, id, true));
    await expect(as('hr', (c) => decideSwap(c, id, true, ''))).rejects.toThrow(/Cannot approve/);
    expect((await as('presenter', (c) => myShifts(c))).map((s: any) => s.d)).toContain(d2);
    await as('hr', (c) => decideSwap(c, id, false, 'Colleague already on shift'));
    expect((await as('presenter', (c) => mySwaps(c))).find((s: any) => s.id === id)!.status).toBe('declined');
  });

  it('declines by the colleague, withdrawal, and own-shift rules', async () => {
    await publish(ids.presenterEmp, d3);
    const entry = (await as('presenter', (c) => myShifts(c))).find((s: any) => s.d === d3)!.id;
    await expect(as('mate', (c) => requestSwap(c, { entryId: entry, targetEmployeeId: ids.presenterEmp }))).rejects.toThrow(/own rostered shifts/);
    await expect(as('presenter', (c) => requestSwap(c, { entryId: entry, targetEmployeeId: ids.presenterEmp }))).rejects.toThrow(/colleague/);
    const id = await as('presenter', (c) => requestSwap(c, { entryId: entry, targetEmployeeId: ids.mateEmp }));
    await as('mate', (c) => colleagueReply(c, id, false));
    expect((await as('presenter', (c) => mySwaps(c))).find((s: any) => s.id === id)!.status).toBe('declined');
    const id2 = await as('presenter', (c) => requestSwap(c, { entryId: entry, targetEmployeeId: ids.mateEmp }));
    await expect(as('mate', (c) => cancelSwap(c, id2))).rejects.toThrow(/Only the person who asked/);
    await as('presenter', (c) => cancelSwap(c, id2));
    await expect(as('presenter', (c) => cancelSwap(c, id2))).rejects.toThrow(/already closed/);
  });

  it('a manager who is part of the swap cannot decide it', async () => {
    const hrEmp = (await (await privileged()).query<any>(`select id from employees where user_id = $1`, [u.hr]))[0].id;
    await publish(hrEmp, addDaysIso(today, 13));
    const p = await privileged();
    const entry = (await p.query<any>(`select id from roster_entries where employee_id = $1 and work_date = $2 and superseded_at is null`, [hrEmp, addDaysIso(today, 13)]))[0].id;
    const id = (await p.query<any>(`insert into shift_swaps (org_id, entry_id, work_date, shift_id, requester_employee_id, target_employee_id, status) values ($1,$2,$3,$4,$5,$6,'awaiting_manager') returning id`, [ids.org, entry, addDaysIso(today, 13), ids.shift, hrEmp, ids.mateEmp]))[0].id;
    await expect(as('hr', (c) => decideSwap(c, id, true, ''))).rejects.toThrow(/Separation of duties/);
  });

  it('other tenants cannot see swaps', async () => {
    const other = (await (await privileged()).query<any>(`select id from organizations where slug = 'gracechapel'`))[0].id;
    expect(await withTenant(other, (q) => q.query('select * from shift_swaps'))).toHaveLength(0);
  });
});

describe('APP_SECRET rotation', () => {
  const OLD = 'old-secret-' + 'a'.repeat(30), NEW = 'new-secret-' + 'b'.repeat(30);
  it('re-encrypts authenticator secrets and sealed payroll values, idempotently', async () => {
    const p = await privileged();
    // values written under the old secret
    const mfaOld = encryptWith(OLD, 'JBSWY3DPEHPK3PXP');
    await p.query('update users set mfa_secret_enc = $2, mfa_enabled = true where id = $1', [u.officer, mfaOld]);
    const old = process.env.APP_SECRET; process.env.APP_SECRET = OLD;
    const sealedOld = seal('0123456789')!;
    process.env.APP_SECRET = old;
    await p.query(`insert into comp_profiles (org_id, employee_id, basic, housing, transport, bank_account, effective_from, created_by) values ($1,$2,100000,0,0,$3, current_date - 3000, $4)`, [ids.org, ids.mateEmp, 'enc:' + sealedOld.slice(4), u.hr]);
    await expect(rotateSecrets(OLD, 'short')).rejects.toThrow(/at least 32/);
    await expect(rotateSecrets(OLD, OLD)).rejects.toThrow(/differ/);
    const r = await rotateSecrets(OLD, NEW);
    expect(r.mfa).toBe(1); expect(r.payroll).toBe(1);
    expect(await rotateSecrets(OLD, NEW)).toEqual({ mfa: 0, payroll: 0 }); // rerun is a no-op
    const mfaNow = (await p.query<any>('select mfa_secret_enc from users where id = $1', [u.officer]))[0].mfa_secret_enc;
    expect(decryptWith(NEW, mfaNow)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => decryptWith(OLD, mfaNow)).toThrow();
    process.env.APP_SECRET = NEW;
    try { expect(unseal((await p.query<any>(`select bank_account from comp_profiles where employee_id = $1 and effective_from < current_date - 2000`, [ids.mateEmp]))[0].bank_account)).toBe('0123456789'); } finally { process.env.APP_SECRET = old; }
  });
  it('reads old values through APP_SECRET_PREVIOUS during the switch-over', () => {
    const old = { s: process.env.APP_SECRET, p: process.env.APP_SECRET_PREVIOUS };
    try {
      process.env.APP_SECRET = OLD;
      const blob = encryptSecret('hello');
      process.env.APP_SECRET = NEW;
      expect(() => decryptSecret(blob)).toThrow();
      process.env.APP_SECRET_PREVIOUS = OLD;
      expect(decryptSecret(blob)).toBe('hello');
      expect(decryptSecret(encryptSecret('fresh'))).toBe('fresh');
    } finally { process.env.APP_SECRET = old.s; if (old.p === undefined) delete process.env.APP_SECRET_PREVIOUS; else process.env.APP_SECRET_PREVIOUS = old.p; }
  });
});
