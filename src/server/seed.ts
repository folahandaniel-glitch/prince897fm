import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SYSTEM_ROLES } from '../domain/policy';
import { type Branding, type Terminology } from '../domain/config-schema';
import { audit } from './audit';
import { seedFinanceDefaults } from './finance';
import { seedRules } from './discipline';
import { seedTicketCategories } from './tickets';
import { DEFAULT_SETTINGS } from '../domain/payroll';
import { hashPassword } from './auth';
import { privileged, withTenant } from './db';

interface Template {
  slug: string; name: string; template: string;
  branding: Branding; terms?: Terminology;
  departments: string[]; branches: { name: string; region?: string }[]; positions: [string, number][];
  superAdmin?: string;
  people: { name: string; email: string; role: string; dept: string; position: string; branch: string }[];
}

const FOOTER = 'Powered by Fodan Softnet Inc. (+234 806 757 8112)';

export const TEMPLATES: Template[] = [
  {
    slug: 'prince897', name: 'PRINCE 89.7 FM', template: 'radio-station',
    branding: { name: 'PRINCE 89.7 FM', shortName: 'PRINCE FM', tagline: '...positive impact to humanity', primary: '#111111', secondary: '#C8102E', accent: '#FFC700', logoUrl: '/brand/prince-wordmark.webp', markUrl: '/brand/prince-emblem.webp', iconBase: '/icons/prince', footer: FOOTER },
    superAdmin: 'superadmin@prince897.example',
    departments: ['Programmes', 'News', 'Production', 'Engineering', 'Advertising & Traffic', 'Marketing', 'Administration & HR', 'Finance', 'Security'],
    branches: [{ name: 'Headquarters', region: 'Head Office' }],
    positions: [['Chairman', 1], ['GCEO', 2], ['CEO', 3], ['Executive Assistant', 10], ['Regional Manager', 20], ['Branch Manager', 30], ['Assistant Branch Manager', 35],
      ['Head of Operations', 40], ['HR Manager', 40], ['Head of Department', 45], ['Director of Programmes', 40], ['Manager', 50], ['Supervisor', 60], ['Senior Staff', 70], ['Junior Staff', 80], ['Intern', 90]],
    people: [
      { name: 'Chairman (demo)', email: 'chairman@prince897.example', role: 'executive', dept: 'Administration & HR', position: 'Chairman', branch: 'Headquarters' },
      { name: 'Admin User (demo)', email: 'admin@prince897.example', role: 'tenant_admin', dept: 'Administration & HR', position: 'HR Manager', branch: 'Headquarters' },
      { name: 'HR Manager (demo)', email: 'hr@prince897.example', role: 'hr_manager', dept: 'Administration & HR', position: 'HR Manager', branch: 'Headquarters' },
      { name: 'Finance Officer (demo)', email: 'officer@prince897.example', role: 'finance_officer', dept: 'Finance', position: 'Senior Staff', branch: 'Headquarters' },
      { name: 'Payment Officer (demo)', email: 'payments@prince897.example', role: 'finance_officer', dept: 'Finance', position: 'Senior Staff', branch: 'Headquarters' },
      { name: 'Accountant (demo)', email: 'accountant@prince897.example', role: 'accountant', dept: 'Finance', position: 'Senior Staff', branch: 'Headquarters' },
      { name: 'Finance Manager (demo)', email: 'finmanager@prince897.example', role: 'finance_manager', dept: 'Finance', position: 'Manager', branch: 'Headquarters' },
      { name: 'CEO (demo)', email: 'ceo@prince897.example', role: 'ceo', dept: 'Administration & HR', position: 'CEO', branch: 'Headquarters' },
      { name: 'Sales Executive (demo)', email: 'sales@prince897.example', role: 'sales', dept: 'Advertising & Traffic', position: 'Senior Staff', branch: 'Headquarters' },
      { name: 'Support Officer (demo)', email: 'support@prince897.example', role: 'support', dept: 'Administration & HR', position: 'Senior Staff', branch: 'Headquarters' },
      { name: 'Head of News (demo)', email: 'head@prince897.example', role: 'department_head', dept: 'News', position: 'Head of Department', branch: 'Headquarters' },
      { name: 'News Presenter (demo)', email: 'presenter@prince897.example', role: 'employee', dept: 'News', position: 'Senior Staff', branch: 'Headquarters' },
    ],
  },
  {
    slug: 'gracechapel', name: 'Grace Chapel', template: 'church',
    branding: { name: 'Grace Chapel', shortName: 'Grace', tagline: 'A community of faith', primary: '#4C1D95', secondary: '#0E7490', accent: '#B45309', logoUrl: '', markUrl: '', iconBase: '', footer: FOOTER },
    terms: {
      employee: { singular: 'Staff member', plural: 'Staff' }, department: { singular: 'Ministry', plural: 'Ministries' },
      branch: { singular: 'Campus', plural: 'Campuses' }, position: { singular: 'Office', plural: 'Offices' },
    },
    superAdmin: 'superadmin@gracechapel.example',
    departments: ['Pastoral Care', 'Worship', 'Children', 'Administration'],
    branches: [{ name: 'Main Campus' }],
    positions: [['General Overseer', 1], ['Pastor', 20], ['Coordinator', 40], ['Volunteer Lead', 60]],
    people: [
      { name: 'Church Admin (demo)', email: 'admin@gracechapel.example', role: 'tenant_admin', dept: 'Administration', position: 'Coordinator', branch: 'Main Campus' },
    ],
  },
];

// Demo salaries only (monthly basic, naira). Real figures are entered by HR under Payroll.
const BASIC_BY_ROLE: Record<string, number> = { executive: 600_000, ceo: 500_000, finance_manager: 300_000, hr_manager: 280_000, department_head: 250_000, tenant_admin: 220_000, accountant: 200_000, finance_officer: 150_000, sales: 160_000, support: 150_000, employee: 120_000 };

function strongPassword() {
  return crypto.randomBytes(15).toString('base64url');
}

export async function seedOrganization(t: Template, creds: string[]) {
  const p = await privileged();
  const [{ id: orgId }] = await p.query<{ id: string }>('insert into organizations (slug, name, template) values ($1,$2,$3) returning id', [t.slug, t.name, t.template]);
  await withTenant(orgId, async (q) => {
    const ids: Record<string, string> = {};
    for (const r of SYSTEM_ROLES) {
      if (r.hidden) continue; // hidden roles are created outside the tenant-restricted connection below
      const [{ id }] = await q.query<{ id: string }>('insert into roles (org_id, key, name, permissions, is_system, hidden) values ($1,$2,$3,$4,true,$5) returning id', [orgId, r.key, r.name, r.permissions, !!r.hidden]);
      ids[`role:${r.key}`] = id;
    }
    // transfer authority is deliberately separate from generic admin
    for (const [i, d] of t.departments.entries()) ids[`d:${d}`] = (await q.query<{ id: string }>('insert into departments (org_id, name, sort_order) values ($1,$2,$3) returning id', [orgId, d, i]))[0].id;
    for (const [i, b] of t.branches.entries()) ids[`b:${b.name}`] = (await q.query<{ id: string }>('insert into branches (org_id, name, region, sort_order) values ($1,$2,$3,$4) returning id', [orgId, b.name, b.region ?? null, i]))[0].id;
    for (const [i, [n, rank]] of t.positions.entries()) ids[`p:${n}`] ??= (await q.query<{ id: string }>('insert into positions (org_id, name, rank_level, sort_order) values ($1,$2,$3,$4) returning id', [orgId, n, rank, i]))[0].id;

    const put = async (kind: 'branding' | 'terminology' | 'navigation', payload: unknown) =>
      q.query(`insert into config_versions (org_id, kind, version, status, payload, note, published_at) values ($1,$2,1,'published',$3::jsonb,'Initial configuration', now())`, [orgId, kind, JSON.stringify(payload)]);
    await put('branding', t.branding);
    if (t.terms) await put('terminology', t.terms);

    // Navigation is not stored: the built-in default applies until an administrator customises it, so new modules appear automatically.

    let n = 0;
    const empByEmail: Record<string, string> = {};
    for (const person of t.people) {
      const pw = strongPassword();
      const [{ id: userId }] = await q.query<{ id: string }>('insert into users (org_id, email, password_hash) values ($1,$2,$3) returning id', [orgId, person.email, hashPassword(pw)]);
      await q.query('insert into user_roles (org_id, user_id, role_id) values ($1,$2,$3)', [orgId, userId, ids[`role:${person.role}`]]);
      const [{ id: empId }] = await q.query<{ id: string }>(
        `insert into employees (org_id, user_id, employee_no, full_name, email, joined_on) values ($1,$2,$3,$4,$5, current_date - 400) returning id`,
        [orgId, userId, `EMP-${String(++n).padStart(4, '0')}`, person.name, person.email]);
      await q.query(`insert into assignments (org_id, employee_id, department_id, branch_id, position_id, valid_from, reason) values ($1,$2,$3,$4,$5, current_date - 400, 'Initial assignment')`,
        [orgId, empId, ids[`d:${person.dept}`], ids[`b:${person.branch}`], ids[`p:${person.position}`]]);
      empByEmail[person.email] = empId;
      const basic = BASIC_BY_ROLE[person.role] ?? 120_000;
      await q.query(`insert into comp_profiles (org_id, employee_id, basic, housing, transport, pension_enabled, effective_from, created_by) values ($1,$2,$3,$4,$5,true, current_date - 400, $6)`, [orgId, empId, basic.toFixed(2), (basic * 0.25).toFixed(2), (basic * 0.1).toFixed(2), userId]);
      creds.push(`${t.slug}\t${person.email}\t${person.role}\t${pw}`);
    }
    // Demo reporting line: the presenter reports to the Head of News.
    if (empByEmail['head@prince897.example'] && empByEmail['presenter@prince897.example'])
      await q.query('update assignments set supervisor_id = $1 where employee_id = $2', [empByEmail['head@prince897.example'], empByEmail['presenter@prince897.example']]);
    // Report templates (editable): PRINCE FM weekly (Friday 18:00) and monthly (last day 18:00); supervisor then executive approve.
    if (t.slug === 'prince897') {
      const fields = JSON.stringify([
        { key: 'work_done', label: 'Work completed this period', type: 'longtext', required: true },
        { key: 'challenges', label: 'Challenges', type: 'longtext', required: false },
        { key: 'next_plans', label: 'Plans for next period', type: 'longtext', required: true },
      ]);
      const chain = JSON.stringify([{ kind: 'supervisor' }, { kind: 'role', roleKey: 'executive' }]);
      await q.query(
        `insert into report_templates (org_id, name, cadence, due_weekday, due_time, fields, chain) values ($1,'Weekly report','weekly',5,'18:00',$2::jsonb,$3::jsonb), ($1,'Monthly report','monthly',null,'18:00',$2::jsonb,$3::jsonb)`,
        [orgId, fields, chain]);
    }
    // Finance: chart of accounts, approval bands and an opening bank balance (demo organisation only).
    if (t.slug === 'prince897') {
      const fm = (await q.query<{ user_id: string }>(`select user_id from employees where email = 'finmanager@prince897.example'`))[0].user_id;
      const fin = await seedFinanceDefaults(q, orgId, fm);
      const year = new Date().getUTCFullYear();
      for (const [code, amt] of [['5000', '6000000.00'], ['5010', '3000000.00'], ['5020', '1200000.00']])
        await q.query('insert into fin_budgets (org_id, year, account_id, amount, approved_by, created_by) values ($1,$2,$3,$4,$5,$5)', [orgId, year, fin[code], amt, fm]);
    }
    await seedRules(q, orgId);
    await seedTicketCategories(q, orgId);
    await q.query(`insert into payroll_settings (org_id, tax_bands, regime_note, verified_by) values ($1,$2::jsonb,$3,$4)`, [orgId, JSON.stringify(DEFAULT_SETTINGS.bands), 'Starting values for demonstration. Confirm every rate against current law.', 'Demo defaults (NOT verified)']);
    await q.query(`insert into fine_policies (org_id, kind, free_per_month, amount_per_incident, monthly_cap, legal_basis, active) values ($1,'lateness',3,1000,10000,'',false), ($1,'absence',0,0,null,'',false)`, [orgId]);
    // Operational defaults (all editable by the administrator; none are hard-coded in the engine).
    for (const [name, code, a, b] of [['Morning', 'MOR', '06:00', '14:00'], ['Day', 'DAY', '08:00', '16:00'], ['Afternoon', 'AFT', '14:00', '22:00'], ['Night', 'NGT', '22:00', '06:00']])
      await q.query('insert into shifts (org_id, name, code, start_time, end_time) values ($1,$2,$3,$4,$5)', [orgId, name, code, a, b]);
    const hq = t.slug === 'prince897'
      ? { name: 'Glass House (Headquarters)', address: 'Glass House, No 1 Onigbagbo Street, Alarere Estate, Lagos-Ibadan Expressway / Iwo Road, Ibadan, Oyo State', lat: 7.3990014, lng: 3.9411920, radius: 150 }
      : { name: t.branches[0].name + ' (set exact coordinates)', address: 'Placeholder location: an administrator must set the real latitude/longitude', lat: 6.5244, lng: 3.3792, radius: 200 };
    await q.query(`insert into workplaces (org_id, name, kind, address, latitude, longitude, radius_m, branch_id) values ($1,$2,'headquarters',$3,$4,$5,$6,$7)`,
      [orgId, hq.name, hq.address, hq.lat, hq.lng, hq.radius, ids[`b:${t.branches[0].name}`]]);
    for (const [name, days, paid] of [['Annual leave', 20, true], ['Sick leave', 12, true], ['Compassionate leave', 5, true], ['Maternity leave', 84, true], ['Study leave', 0, false]] as const)
      await q.query('insert into leave_types (org_id, name, annual_days, paid) values ($1,$2,$3,$4)', [orgId, name, days, paid]);
    await audit(q, { orgId, action: 'organization.provisioned', entity: 'organization', entityId: orgId, after: { template: t.template } });
  });
  if (t.superAdmin) await createSuperAdmin(orgId, t.superAdmin, creds, t.slug);
}

/** The hidden Super Administrator: invisible to all other users (database-enforced), full authority, can assist the Chairman. */
export async function createSuperAdmin(orgId: string, email: string, creds: string[] | null, slug = '') {
  const p = await privileged();
  const pw = strongPassword();
  const roleDef = SYSTEM_ROLES.find((r) => r.key === 'super_admin')!;
  const role = (await p.query<{ id: string }>('insert into roles (org_id, key, name, permissions, is_system, hidden) values ($1,$2,$3,$4,true,true) returning id', [orgId, roleDef.key, roleDef.name, roleDef.permissions]))[0].id;
  const [{ id: userId }] = await p.query<{ id: string }>('insert into users (org_id, email, password_hash, hidden, platform_admin, must_change_password) values ($1,$2,$3,true,true,$4) returning id', [orgId, email.toLowerCase(), hashPassword(pw), creds === null]);
  const [{ n }] = await p.query<{ n: number }>('select count(*)::int n from employees where org_id = $1', [orgId]);
  await p.query(
    `insert into employees (org_id, user_id, employee_no, full_name, email, joined_on, hidden) values ($1,$2,$3,'Super Administrator',$4, current_date, true)`,
    [orgId, userId, `SYS-${String(n + 1).padStart(4, '0')}`, email.toLowerCase()]);
  await p.query('insert into user_roles (org_id, user_id, role_id) values ($1,$2,$3)', [orgId, userId, role]);
  const exec = await p.query<{ id: string }>(`select id from roles where org_id = $1 and key = 'executive'`, [orgId]);
  // Lets the Super Admin act in the Chairman's approval stages when assisting.
  if (exec[0]) await p.query('insert into user_roles (org_id, user_id, role_id) values ($1,$2,$3)', [orgId, userId, exec[0].id]);
  creds?.push(`${slug}\t${email}\tsuper_admin\t${pw}`);
  return { userId, password: pw };
}

/** Development convenience: create demo tenants on an empty database. Credentials are written to a git-ignored file, never logged. */
export async function seedDemoIfEmpty() {
  if (process.env.SEED_DEMO === 'false' || (process.env.NODE_ENV === 'production' && process.env.SEED_DEMO !== 'force')) return; // 'force' = local production-mode demo only
  const p = await privileged();
  const [{ c }] = await p.query<{ c: number }>('select count(*)::int c from organizations');
  if (c > 0) return;
  const creds: string[] = ['org\temail\trole\tpassword'];
  for (const t of TEMPLATES) await seedOrganization(t, creds);
  const file = path.join(process.cwd(), '.data', 'seed-credentials.txt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, creds.join('\n') + '\n');
  console.log(`[worksuite] Demo tenants created. Sign-in details saved to ${file}`);
}
