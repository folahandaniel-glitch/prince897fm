import { beforeAll, describe, expect, it } from 'vitest';
import { privileged, withTenant } from '../src/server/db';
import { seedOrganization, TEMPLATES } from '../src/server/seed';
import { runAs } from '../src/server/ctx';
import { ForbiddenError } from '../src/domain/policy';
import { completeMfa, login, resolveSession, changePassword } from '../src/server/auth';
import { encryptSecret, decryptSecret, generateSecret, totp, verifyTotp, unbase32, base32 } from '../src/server/mfa';
import { archiveRecord, createRecord, getEntity, getRecord, getPageForView, listRecords, pageVersions, recordsCsv, saveAutomation, saveEntity, savePage, submitPublicForm, transitionRecord, updateRecord } from '../src/server/builders';
import { createWallboard, revokeWallboard, saveDashboard, viewDashboard, wallboardData } from '../src/server/dashboards';
import { chairmanQueue, createUser, exportConfig, importConfig, installPack, listFeatures, listRoles, listUsers, overview, provisionOrganization, resetPassword, saveRole, setFeature, setUserRoles, setUserStatus } from '../src/server/backend';
import { addVersion, archiveDocument, downloadVersion, expiryAlerts, getDocument, listDocuments, uploadDocument } from '../src/server/documents';
import { directory, getThread, listMail, move, send, unreadCount } from '../src/server/mail';
import { activeAnnouncements, createEvent, monthView, postAnnouncement } from '../src/server/calendar';

const ids: Record<string, string> = {};
const u: Record<string, string> = {};
const as = <T>(who: string, fn: Parameters<typeof runAs<T>>[2]) => runAs(ids.org, u[who], fn);
const pdf = (n = 300) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('x'.repeat(n))]);

beforeAll(async () => {
  const lines: string[] = [];
  for (const t of TEMPLATES) await seedOrganization(t, lines);
  const p = await privileged();
  ids.org = (await p.query<any>(`select id from organizations where slug = 'prince897'`))[0].id;
  ids.church = (await p.query<any>(`select id from organizations where slug = 'gracechapel'`))[0].id;
  for (const n of ['superadmin', 'admin', 'chairman', 'hr', 'head', 'presenter', 'officer', 'sales', 'support']) u[n] = (await p.query<any>(`select u.id from users u join organizations o on o.id=u.org_id where o.slug='prince897' and u.email=$1`, [`${n}@prince897.example`]))[0].id;
  ids.creds = lines.find((l) => l.includes('superadmin@prince897')) ?? '';
});

describe('MFA (TOTP)', () => {
  it('matches the RFC 6238 test vector and tolerates one step of clock drift', () => {
    const secret = base32(Buffer.from('12345678901234567890'));
    expect(totp(secret, 59_000, 30, 8)).toBe('94287082');
    expect(verifyTotp(secret, totp(secret, 1_000_000_000))).toBe(false); // an old code is rejected now
    const now = Date.now();
    expect(verifyTotp(secret, totp(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now - 120_000), now)).toBe(false);
    expect(verifyTotp(secret, '12ab56')).toBe(false);
    expect(unbase32(secret).toString()).toBe('12345678901234567890');
  });
  it('encrypts secrets at rest and detects tampering', () => {
    const s = generateSecret();
    const blob = encryptSecret(s);
    expect(blob).not.toContain(s);
    expect(decryptSecret(blob)).toBe(s);
    expect(() => decryptSecret(blob.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toThrow();
  });
  it('a sign-in with MFA enabled is not usable until the code is verified', async () => {
    const p = await privileged();
    const secret = generateSecret();
    const creds = (await p.query<any>(`select id from users where email = 'accountant@prince897.example'`))[0].id;
    await p.query('update users set mfa_secret_enc = $2, mfa_enabled = true where id = $1', [creds, encryptSecret(secret)]);
    const pw = (await createUserPassword('accountant@prince897.example'));
    const r = await login('prince897', 'accountant@prince897.example', pw, '7.7.7.7');
    expect(r.ok && r.mfaRequired).toBe(true);
    const token = (r as any).token;
    expect(await resolveSession(token)).toBeNull();                      // password alone is not a session
    expect((await completeMfa(token, '000000')).ok).toBe(false);
    expect((await completeMfa(token, totp(secret))).ok).toBe(true);
    expect(await resolveSession(token)).toBeTruthy();
  });
  it('password change enforces the policy and signs out other sessions', async () => {
    const pw = await createUserPassword('support@prince897.example');
    const a = await login('prince897', 'support@prince897.example', pw, '8.8.8.1');
    const b = await login('prince897', 'support@prince897.example', pw, '8.8.8.2');
    expect(a.ok && b.ok).toBe(true);
    expect(await changePassword(u.support, 'support@prince897.example', pw, 'short', (a as any).token)).toMatch(/12 characters/);
    expect(await changePassword(u.support, 'support@prince897.example', 'wrong-current-password', 'a-brand-new-long-passphrase', (a as any).token)).toMatch(/not correct/);
    expect(await changePassword(u.support, 'support@prince897.example', pw, 'a-brand-new-long-passphrase-7', (a as any).token)).toBeNull();
    expect(await resolveSession((a as any).token)).toBeTruthy();
    expect(await resolveSession((b as any).token)).toBeNull();
  });
});

async function createUserPassword(email: string) {
  // set a known password directly for tests (the real flow shows a one-time password)
  const { hashPassword } = await import('../src/server/auth');
  const pw = `Test-pass-${Math.random().toString(36).slice(2)}-xyz`;
  await (await privileged()).query('update users set password_hash = $2, must_change_password = false where email = $1', [email, hashPassword(pw)]);
  return pw;
}

describe('custom modules (builder)', () => {
  it('only builders can define modules; packs install as configuration', async () => {
    await expect(as('presenter', (c) => installPack(c, 'procurement'))).rejects.toBeInstanceOf(ForbiddenError);
    await as('admin', (c) => installPack(c, 'procurement'));
    await expect(as('admin', (c) => installPack(c, 'procurement'))).rejects.toThrow(/already installed/);
    const e = await withTenant(ids.org, (q) => getEntity(q, 'procurement'));
    expect(e!.fields.length).toBeGreaterThan(3);
  });
  let recId = '';
  it('records are validated, numbered, searchable and audited', async () => {
    await expect(as('presenter', (c) => createRecord(c, 'procurement', { item: 'Mic', quantity: 'abc', estimate: '5000', justification: 'Studio needs a new mic' }))).rejects.toThrow(/number/);
    const r = await as('presenter', (c) => createRecord(c, 'procurement', { item: 'Condenser microphone', quantity: '2', estimate: '650,000', justification: 'Studio 2 mics are failing on air' }));
    recId = r.id;
    expect(r.number).toBe('PRQ-00001');
    const list = await as('presenter', (c) => listRecords(c, 'procurement', { q: 'condenser' }));
    expect(list!.rows).toHaveLength(1);
    await as('presenter', (c) => updateRecord(c, 'procurement', recId, { item: 'Condenser microphone', quantity: '3', estimate: '650,000', justification: 'Studio 2 mics are failing on air' }))
      .then(() => { throw new Error('should not edit'); }, (e) => expect(e).toBeInstanceOf(ForbiddenError));
    const view = (await as('presenter', (c) => getRecord(c, 'procurement', recId)))!;
    expect(view.history[0].action).toBe('record.created');
  });
  it('workflow moves are limited by role', async () => {
    await expect(as('presenter', (c) => transitionRecord(c, 'procurement', recId, 'approved', ''))).rejects.toThrow(/Only/);
    await expect(as('head', (c) => transitionRecord(c, 'procurement', recId, 'received', ''))).rejects.toThrow(/does not allow/);
    await as('head', (c) => transitionRecord(c, 'procurement', recId, 'approved', 'Needed on air'));
    expect((await as('head', (c) => getRecord(c, 'procurement', recId)))!.rec.status).toBe('approved');
  });
  it('automations notify roles when conditions match, using data not code', async () => {
    await expect(as('admin', (c) => saveAutomation(c, { entityKey: 'procurement', name: 'Bad', trigger: 'record_created', conditions: [{ field: 'nope', op: 'gt', value: '1' }], actions: [{ type: 'notify_role', role: 'ceo' }] }))).rejects.toThrow(/Unknown field/);
    await as('admin', (c) => saveAutomation(c, { entityKey: 'procurement', name: 'Large purchase to CEO', trigger: 'record_created', conditions: [{ field: 'estimate', op: 'gte', value: '500000' }], actions: [{ type: 'notify_role', role: 'ceo', message: 'Large request {number}: {item}' }] }));
    await as('presenter', (c) => createRecord(c, 'procurement', { item: 'Mixing console', quantity: '1', estimate: '900000', justification: 'Replace the faulty console in Studio 1' }));
    await as('presenter', (c) => createRecord(c, 'procurement', { item: 'Cables', quantity: '10', estimate: '20000', justification: 'Replacing worn out XLR cables' }));
    const n = await withTenant(ids.org, (q) => q.query<any>(`select body from notifications where title like '%Large purchase%'`));
    expect(n.length).toBe(1);
    expect(n[0].body).toBe('Large request PRQ-00002: Mixing console');
  });
  it('removing a field archives it, so old data is never lost', async () => {
    const e = (await withTenant(ids.org, (q) => getEntity(q, 'procurement')))!;
    await as('admin', (c) => saveEntity(c, { ...e, fields: e.fields.filter((f) => f.key !== 'needed_by') }));
    const after = (await withTenant(ids.org, (q) => getEntity(q, 'procurement')))!;
    expect(after.fields.find((f) => f.key === 'needed_by')!.archived).toBe(true);
    expect(after.version).toBe(e.version + 1);
  });
  it('archiving and CSV export are controlled and the export is formula-safe', async () => {
    await expect(as('presenter', (c) => archiveRecord(c, 'procurement', recId, 'because'))).rejects.toBeInstanceOf(ForbiddenError);
    await as('presenter', (c) => createRecord(c, 'procurement', { item: '=SUM(A1:A9)', quantity: '1', estimate: '1000', justification: 'Formula injection check text' }));
    const csv = await as('admin', (c) => recordsCsv(c, 'procurement'));
    expect(csv).toContain(`"'=SUM(A1:A9)"`);
    await expect(as('presenter', (c) => recordsCsv(c, 'procurement'))).rejects.toBeInstanceOf(ForbiddenError);
    await as('admin', (c) => archiveRecord(c, 'procurement', recId, 'Duplicate request'));
    expect((await as('admin', (c) => listRecords(c, 'procurement')))!.rows.some((r: any) => r.id === recId)).toBe(false);
  });
});

describe('public forms', () => {
  it('accept anonymous submissions with validation, a honeypot and a rate limit', async () => {
    await as('admin', (c) => installPack(c, 'public_complaints'));
    const ok = await submitPublicForm('prince897', 'complaints', { name: 'Mr Ade', office: 'Records', complaint: 'The records office was closed during official hours.' }, '5.5.5.5');
    expect(ok.number).toMatch(/^CMP-/);
    await expect(submitPublicForm('prince897', 'complaints', { name: 'x' }, '5.5.5.5')).rejects.toThrow(/required/);
    expect((await submitPublicForm('prince897', 'complaints', { name: 'Bot', office: 'x', complaint: 'spam spam spam', website: 'http://spam' }, '6.6.6.6')).number).toBe('OK');
    expect((await withTenant(ids.org, (q) => q.query<any>(`select count(*)::int c from custom_records r join custom_entities e on e.id = r.entity_id where e.key = 'public_complaints'`)))[0].c).toBe(1); // bot stored nothing
    for (let i = 0; i < 4; i++) await submitPublicForm('prince897', 'complaints', { name: `N${i}`, office: 'Office', complaint: 'Another valid complaint text here.' }, '5.5.5.5');
    await expect(submitPublicForm('prince897', 'complaints', { name: 'N9', office: 'Office', complaint: 'One too many from this network.' }, '5.5.5.5')).rejects.toThrow(/Too many/);
    await expect(submitPublicForm('prince897', 'nonexistent', {}, null)).rejects.toThrow(/not available/);
    const row = (await withTenant(ids.org, (q) => q.query<any>(`select r.created_by from custom_records r join custom_entities e on e.id = r.entity_id where e.key = 'public_complaints' limit 1`)))[0];
    expect(row.created_by).toBeNull();
    // only configured roles can read the submissions
    await expect(as('presenter', (c) => listRecords(c, 'public_complaints'))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await as('admin', (c) => listRecords(c, 'public_complaints')))!.rows.length).toBe(5);
  });
});

describe('dashboards, wallboards and pages', () => {
  it('dashboards hide figures a viewer is not allowed to see', async () => {
    const slug = await as('admin', (c) => saveDashboard(c, { slug: 'ops', name: 'Operations', device: 'any', roles: ['*'], widgets: [
      { id: 'a', type: 'metric', title: 'Staff', metric: 'staff_active' }, { id: 'b', type: 'metric', title: 'Cash', metric: 'finance_cash' },
      { id: 'c', type: 'entity_count', title: 'Requests', entity: 'procurement' }, { id: 'd', type: 'text', title: 'Note', text: 'Welcome' }] }));
    const admin = (await as('admin', (c) => viewDashboard(c, slug)))!;
    expect(admin.results.some((r) => r.widget.metric === 'finance_cash')).toBe(false);        // admins have no finance access
    const chair = (await as('chairman', (c) => viewDashboard(c, slug)))!;
    expect(chair.results.find((r) => r.widget.metric === 'finance_cash')!.value).toMatch(/5,000,000/);
    await expect(as('presenter', (c) => saveDashboard(c, { slug: 'x', name: 'x', device: 'any', roles: ['*'], widgets: [] }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('admin', (c) => saveDashboard(c, { slug: 'bad', name: 'Bad', device: 'any', roles: ['*'], widgets: [{ id: 'z', type: 'metric', title: 'z', metric: 'drop_table' }] }))).rejects.toThrow(/Unknown metric/);
  });
  it('wallboards are token-paired, read-only and never show sensitive figures', async () => {
    const dash = (await withTenant(ids.org, (q) => q.query<any>(`select id from dashboards where slug = 'ops'`)))[0].id;
    const token = await as('admin', (c) => createWallboard(c, { name: 'Newsroom TV', dashboardId: dash, refreshSeconds: 60 }));
    const data = (await wallboardData(token))!;
    expect(data.name).toBe('Newsroom TV');
    expect(data.results.some((r) => r.widget.metric === 'finance_cash')).toBe(false);
    expect(data.results.some((r) => r.widget.metric === 'staff_active')).toBe(true);
    expect(data.results.find((r) => r.widget.type === 'entity_count')!.value).toBeDefined();
    expect(await wallboardData(token + 'x')).toBeNull();
    expect(await wallboardData('short')).toBeNull();
    const stored = await (await privileged()).query<any>('select token_hash from wallboard_devices');
    expect(stored[0].token_hash).not.toContain(token);
    const devId = (await withTenant(ids.org, (q) => q.query<any>('select id from wallboard_devices')))[0].id;
    await as('admin', (c) => revokeWallboard(c, devId));
    expect(await wallboardData(token)).toBeNull();
  });
  it('pages block unsafe links, keep versions, and respect publication and roles', async () => {
    await expect(as('admin', (c) => savePage(c, { slug: 'rules', title: 'House rules', roles: ['*'], publish: true, blocks: [{ type: 'button', label: 'Go', href: 'javascript:alert(1)' }] }))).rejects.toThrow(/link must be/);
    await as('admin', (c) => savePage(c, { slug: 'rules', title: 'House rules', roles: ['*'], publish: false, blocks: [{ type: 'heading', text: 'Rules' }, { type: 'text', text: '<script>alert(1)</script> Be on time.' }] }));
    expect(await as('presenter', (c) => getPageForView(c, 'rules'))).toBeNull();            // drafts are invisible to staff
    await as('admin', (c) => savePage(c, { slug: 'rules', title: 'House rules', roles: ['hr_manager'], publish: true, blocks: [{ type: 'heading', text: 'Rules' }] }));
    expect(await as('presenter', (c) => getPageForView(c, 'rules'))).toBeNull();            // published but limited to HR
    expect((await as('hr', (c) => getPageForView(c, 'rules')))!.title).toBe('House rules');
    expect((await as('admin', (c) => pageVersions(c, 'rules'))).length).toBe(2);
  });
});

describe('the BackEnd (Super Administrator)', () => {
  it('is available only to the Super Administrator; the Chairman and admins cannot open it', async () => {
    for (const who of ['chairman', 'admin', 'hr']) { await expect(as(who, (c) => overview(c))).rejects.toBeInstanceOf(ForbiddenError); await expect(as(who, (c) => listUsers(c))).rejects.toBeInstanceOf(ForbiddenError); }
    const o = await as('superadmin', (c) => overview(c));
    expect(o.users).toBeGreaterThan(5);
    expect(o.migrations.length).toBeGreaterThanOrEqual(9);
  });
  it('creates users with one-time passwords that must be changed, resets and disables accounts', async () => {
    const r = await as('superadmin', (c) => createUser(c, { email: 'new.hire@prince897.example', fullName: 'New Hire', roleKey: 'employee' }));
    const s = await login('prince897', 'new.hire@prince897.example', r.password, '9.9.9.1');
    expect(s.ok).toBe(true);
    expect((await resolveSession((s as any).token))!.must_change_password).toBe(true);
    await expect(as('superadmin', (c) => createUser(c, { email: 'x@prince897.example', fullName: 'Xavier Test', roleKey: 'super_admin' }))).rejects.toThrow(/cannot be granted/);
    const pw2 = await as('superadmin', (c) => resetPassword(c, r.id));
    expect(await resolveSession((s as any).token)).toBeNull();                        // old sessions are revoked
    expect((await login('prince897', 'new.hire@prince897.example', pw2, '9.9.9.2')).ok).toBe(true);
    await expect(as('superadmin', (c) => setUserStatus(c, r.id, false, 'x'))).rejects.toThrow(/reason/);
    await as('superadmin', (c) => setUserStatus(c, r.id, false, 'Left the organisation'));
    expect((await login('prince897', 'new.hire@prince897.example', pw2, '9.9.9.3')).ok).toBe(false);
    await expect(as('superadmin', (c) => setUserStatus(c, u.superadmin, false, 'self lockout attempt'))).rejects.toThrow(/own account/);
  });
  it('edits roles safely and never exposes itself', async () => {
    await expect(as('superadmin', (c) => saveRole(c, { key: 'trainer', name: 'Trainer', permissions: ['not:real'] }))).rejects.toThrow(/Unknown permission/);
    await expect(as('superadmin', (c) => saveRole(c, { key: 'trainer', name: 'Trainer', permissions: ['backend:access'] }))).rejects.toThrow(/reserved/);
    await as('superadmin', (c) => saveRole(c, { key: 'trainer', name: 'Trainer', permissions: ['doc:view', 'calendar:view', 'event:create'] }));
    await as('superadmin', (c) => setUserRoles(c, u.presenter, ['employee', 'trainer']));
    const users = await as('superadmin', (c) => listUsers(c));
    expect(users.find((x: any) => x.email === 'presenter@prince897.example').role_keys).toEqual(expect.arrayContaining(['employee', 'trainer']));
    expect(users.some((x: any) => x.hidden)).toBe(true);                                // the Super Admin sees its own account
    const roles = await as('superadmin', (c) => listRoles(c));
    expect(roles.some((r: any) => r.key === 'super_admin')).toBe(true);
    const asChair = await as('chairman', (c) => c.q.query<any>('select key from roles'));
    expect(asChair.some((r: any) => r.key === 'super_admin')).toBe(false);
    await expect(as('superadmin', (c) => setUserRoles(c, u.presenter, ['super_admin']))).rejects.toThrow(/cannot be granted/);
  });
  it('feature switches hide modules per organisation', async () => {
    await as('superadmin', (c) => setFeature(c, 'crm', false));
    expect((await as('superadmin', (c) => listFeatures(c))).find((f) => f.key === 'crm')!.enabled).toBe(false);
    const off = await withTenant(ids.org, (q) => q.query<any>('select key from org_features where not enabled'));
    expect(off.map((r: any) => r.key)).toEqual(['crm']);
    const other = await withTenant(ids.church, (q) => q.query<any>('select key from org_features where not enabled'));
    expect(other).toHaveLength(0);
    await as('superadmin', (c) => setFeature(c, 'crm', true));
    await expect(as('superadmin', (c) => setFeature(c, 'unknown', true))).rejects.toThrow(/Unknown module/);
  });
  it('lets the Super Administrator see and act on what is waiting for the Chairman', async () => {
    const q = await as('superadmin', (c) => chairmanQueue(c));
    expect(Array.isArray(q.fin) && Array.isArray(q.rep)).toBe(true);
    expect(await as('superadmin', async (c) => c.subject.grants.some((g) => g.roleKey === 'executive'))).toBe(true);
  });
  it('exports configuration and imports it additively into another organisation (with a dry run)', async () => {
    const bundle = await as('superadmin', (c) => exportConfig(c));
    expect(bundle.entities.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(bundle)).not.toMatch(/password|token_hash|mfa_secret/i);
    const churchAdmin = (await (await privileged()).query<any>(`select u.id from users u where u.org_id = $1 and u.email = 'superadmin@gracechapel.example'`, [ids.church]))[0].id;
    const dry = await runAs(ids.church, churchAdmin, (c) => importConfig(c, JSON.stringify(bundle), true));
    expect(dry.dryRun).toBe(true);
    expect((await withTenant(ids.church, (q) => q.query<any>('select count(*)::int c from custom_entities')))[0].c).toBe(0);
    const real = await runAs(ids.church, churchAdmin, (c) => importConfig(c, JSON.stringify(bundle), false));
    expect(real.created.entities).toBeGreaterThanOrEqual(2);
    const again = await runAs(ids.church, churchAdmin, (c) => importConfig(c, JSON.stringify(bundle), false));
    expect(again.created.entities ?? 0).toBe(0);                                      // idempotent: nothing overwritten
    await expect(runAs(ids.church, churchAdmin, (c) => importConfig(c, '{"nope":1}', true))).rejects.toThrow(/not a WorkSuite/);
  });
  it('creates a whole new organisation from a template (platform operators only)', async () => {
    await expect(provisionOrganization({ orgId: ids.org, userId: u.chairman }, { slug: 'x-school', name: 'X', templateKey: 'school', adminEmail: 'a@x.example' })).rejects.toBeInstanceOf(ForbiddenError);
    const r = await provisionOrganization({ orgId: ids.org, userId: u.superadmin }, { slug: 'st-marys-school', name: "St Mary's School", templateKey: 'school', adminEmail: 'principal@stmarys.example', superAdminEmail: 'support@fodan.example' });
    expect(r.adminPassword.length).toBeGreaterThan(12);
    const sess = await login('st-marys-school', 'principal@stmarys.example', r.adminPassword, '4.4.4.4');
    expect(sess.ok).toBe(true);
    const org = (await (await privileged()).query<any>(`select id from organizations where slug = 'st-marys-school'`))[0].id;
    expect((await withTenant(org, (q) => q.query<any>('select count(*)::int c from departments')))[0].c).toBe(5);
    expect((await withTenant(org, (q) => q.query<any>('select count(*)::int c from custom_entities')))[0].c).toBe(1); // Student Affairs pack
    expect((await withTenant(org, (q) => q.query<any>('select count(*)::int c from fin_accounts')))[0].c).toBeGreaterThan(10);
    await expect(provisionOrganization({ orgId: ids.org, userId: u.superadmin }, { slug: 'st-marys-school', name: 'Dup', templateKey: 'school', adminEmail: 'p@x.example' })).rejects.toThrow(/already taken/);
    // the new organisation cannot see Prince FM data
    expect((await withTenant(org, (q) => q.query<any>('select count(*)::int c from employees')))[0].c).toBe(1);
  });
});

describe('documents', () => {
  let docId = '';
  it('are versioned, fingerprinted, access-controlled and audited', async () => {
    docId = await as('hr', (c) => uploadDocument(c, { title: 'Staff handbook', category: 'Policy', sensitivity: 'internal', roles: ['*'], filename: 'handbook.pdf', data: pdf(), expiresOn: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10) }));
    const conf = await as('hr', (c) => uploadDocument(c, { title: 'Executive contract', category: 'Contract', sensitivity: 'confidential', roles: ['executive', 'hr_manager'], filename: 'contract.pdf', data: pdf(500) }));
    expect((await as('presenter', (c) => listDocuments(c))).map((d: any) => d.title)).toEqual(['Staff handbook']);
    expect((await as('chairman', (c) => listDocuments(c))).length).toBe(2);
    await expect(as('presenter', (c) => getDocument(c, conf))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as('presenter', (c) => downloadVersion(c, conf))).rejects.toBeInstanceOf(ForbiddenError);
    const f = (await as('presenter', (c) => downloadVersion(c, docId)))!;
    expect(f.mime).toBe('application/pdf');
    await expect(as('presenter', (c) => addVersion(c, docId, 'v2.pdf', pdf(), 'x'))).rejects.toThrow(/Only the owner/);
    await as('hr', (c) => addVersion(c, docId, 'handbook-v2.pdf', pdf(400), 'Updated leave policy'));
    expect((await as('hr', (c) => getDocument(c, docId)))!.versions.map((v: any) => v.version)).toEqual([2, 1]);
    const log = await withTenant(ids.org, (q) => q.query<any>(`select count(*)::int c from audit_events where action = 'document.downloaded'`));
    expect(log[0].c).toBe(1);
  });
  it('reject disguised files, accept Office files, and detect swapped content', async () => {
    await expect(as('hr', (c) => uploadDocument(c, { title: 'Bad', category: 'General', sensitivity: 'internal', roles: ['*'], filename: 'x.pdf', data: Buffer.from('MZ\x90\x00 not a pdf') }))).rejects.toThrow(/Only PDF/);
    await expect(as('hr', (c) => uploadDocument(c, { title: 'Zip bomb', category: 'General', sensitivity: 'internal', roles: ['*'], filename: 'x.zip', data: Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(50)]) }))).rejects.toThrow(/Only PDF/);
    await as('hr', (c) => uploadDocument(c, { title: 'Budget', category: 'Finance', sensitivity: 'internal', roles: ['*'], filename: 'budget.xlsx', data: Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(50)]) }));
    await (await privileged()).query(`update document_versions set data = decode('255044462d', 'hex') || data where document_id = $1 and version = 2`, [docId]);
    await expect(as('hr', (c) => downloadVersion(c, docId))).rejects.toThrow(/Integrity check failed/);
  });
  it('warns about expiry once and supports archiving with a reason', async () => {
    expect(await withTenant(ids.org, (q) => expiryAlerts(q, ids.org))).toBeGreaterThan(0);
    expect(await withTenant(ids.org, (q) => expiryAlerts(q, ids.org))).toBe(0);
    await expect(as('hr', (c) => archiveDocument(c, docId, 'no'))).rejects.toThrow(/reason/);
    await as('hr', (c) => archiveDocument(c, docId, 'Superseded by the 2027 handbook'));
    expect((await as('hr', (c) => listDocuments(c))).some((d: any) => d.id === docId)).toBe(false);
  });
});

describe('internal mail', () => {
  let thread = '';
  it('is private to sender and recipients, with threads, read state and folders', async () => {
    const dir = await as('presenter', (c) => directory(c));
    expect(dir.some((d: any) => /superadmin/.test(d.email))).toBe(false);               // the hidden account is not even listed
    thread = await as('presenter', (c) => send(c, { to: [u.head], cc: [u.hr], subject: 'Leave swap for Friday', body: 'Can we swap the Friday morning shift?', priority: 'high' }));
    expect(await as('head', (c) => unreadCount(c))).toBe(1);
    expect((await as('head', (c) => listMail(c, 'inbox')))[0].subject).toBe('Leave swap for Friday');
    expect((await as('presenter', (c) => listMail(c, 'sent')))).toHaveLength(1);
    await expect(as('officer', async (c) => getThread(c, thread))).resolves.toBeNull();           // outsiders cannot read it
    await expect(as('officer', (c) => send(c, { to: [u.head], subject: 'Hijack', body: 'reply into a thread I am not in', threadId: thread }))).rejects.toThrow(/part of/);
    const t = (await as('head', (c) => getThread(c, thread)))!;
    expect(t.msgs).toHaveLength(1);
    expect(await as('head', (c) => unreadCount(c))).toBe(0);
    await as('head', (c) => send(c, { to: [u.presenter], subject: 'Re: Leave swap for Friday', body: 'Approved, go ahead.', threadId: thread }));
    expect((await as('presenter', (c) => getThread(c, thread)))!.msgs).toHaveLength(2);
    await as('head', (c) => move(c, thread, 'archive'));
    expect((await as('head', (c) => listMail(c, 'inbox'))).length).toBe(0);
    expect((await as('head', (c) => listMail(c, 'archive'))).length).toBe(1);
  });
  it('refuses unknown or hidden recipients and empty messages', async () => {
    await expect(as('presenter', (c) => send(c, { to: [u.superadmin], subject: 'Hi', body: 'Hello hidden admin' }))).rejects.toThrow(/does not exist/);
    await expect(as('presenter', (c) => send(c, { to: [], subject: 'Hi', body: 'x' }))).rejects.toThrow(/recipient/);
    await expect(as('presenter', (c) => send(c, { to: [u.head], subject: '', body: 'x' }))).rejects.toThrow(/subject/);
  });
});

describe('calendar and announcements', () => {
  it('shows each person their own shifts and the events they are invited to', async () => {
    const d = new Date(Date.now() + 3 * 86_400_000);
    await as('hr', (c) => createEvent(c, { title: 'All-staff meeting', kind: 'meeting', startsAt: d.toISOString(), roles: ['*'], location: 'Glass House' }));
    await as('hr', (c) => createEvent(c, { title: 'HR only briefing', kind: 'meeting', startsAt: d.toISOString(), roles: ['hr_manager'] }));
    await expect(as('officer', (c) => createEvent(c, { title: 'Nope', kind: 'event', startsAt: d.toISOString(), roles: ['*'] }))).rejects.toBeInstanceOf(ForbiddenError);
    const month = d.toISOString().slice(0, 7);
    const mine = await as('presenter', (c) => monthView(c, month));
    expect(mine.items.map((i) => i.title)).toContain('All-staff meeting');
    expect(mine.items.map((i) => i.title)).not.toContain('HR only briefing');
    expect((await as('hr', (c) => monthView(c, month))).items.map((i) => i.title)).toContain('HR only briefing');
    await expect(as('hr', (c) => createEvent(c, { title: 'Backwards', kind: 'event', startsAt: d.toISOString(), endsAt: new Date(d.getTime() - 1000).toISOString(), roles: ['*'] }))).rejects.toThrow(/cannot end/);
  });
  it('announcements are targeted by role', async () => {
    await as('hr', (c) => postAnnouncement(c, { title: 'Public holiday Monday', body: 'The station runs a holiday schedule.', roles: ['*'], pinned: true }));
    await as('hr', (c) => postAnnouncement(c, { title: 'Payroll cut-off', body: 'HR and finance only.', roles: ['hr_manager', 'finance_manager'] }));
    expect((await as('presenter', (c) => activeAnnouncements(c))).map((a: any) => a.title)).toEqual(['Public holiday Monday']);
    expect((await as('hr', (c) => activeAnnouncements(c))).length).toBe(2);
    await expect(as('presenter', (c) => postAnnouncement(c, { title: 'Spam', body: 'x', roles: ['*'] }))).rejects.toBeInstanceOf(ForbiddenError);
  });
});
