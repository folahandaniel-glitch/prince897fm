import { addDays, localParts } from '../domain/attendance';
import { fromDb, parseMoney, toDb, MoneyError, formatMoney } from '../domain/finance';
import { absenceFines, computePayslip, DEFAULT_SETTINGS, latenessFines, workingDaysDivisor, type Compensation, type Credit, type Debit, type PayrollSettings } from '../domain/payroll';
import { can } from '../domain/policy';
import { mask, seal, unseal } from './sensitive';
import { audit } from './audit';
import { need, UserError, type Ctx } from './ctx';
import type { Q } from './db';
import { cashBalance, ensureAccount, postEntry } from './finance';
import { notify } from './hr';
import type { Line } from '../domain/finance';

const CUR = `a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= current_date and (a.valid_to is null or a.valid_to > current_date)`;
const periodRe = /^\d{4}-\d{2}$/;
const money = (s: string) => { try { return parseMoney(s); } catch (e) { if (e instanceof MoneyError) throw new UserError(e.message); throw e; } };
const monthRange = (period: string) => { const [y, m] = period.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` }; };
const d10 = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

// ---- Settings ---------------------------------------------------------------------------------------------------------------------
export async function getSettings(q: Q) {
  const r = (await q.query<any>('select * from payroll_settings'))[0];
  if (!r) return { settings: DEFAULT_SETTINGS, saved: false, verifiedBy: null as string | null, verifiedOn: null as string | null, note: null as string | null };
  const settings: PayrollSettings = {
    bands: r.tax_bands, pensionEmployeePct: Number(r.pension_employee_pct), pensionEmployerPct: Number(r.pension_employer_pct), nhfPct: Number(r.nhf_pct), nsitfPct: Number(r.nsitf_employer_pct),
    rentReliefPct: Number(r.rent_relief_pct), rentReliefCap: fromDb(r.rent_relief_cap), maxDiscretionaryPct: Number(r.max_discretionary_pct),
  };
  return { settings, saved: true, verifiedBy: r.verified_by as string | null, verifiedOn: r.verified_on ? d10(r.verified_on) : null, note: r.regime_note as string | null };
}

export async function saveSettings(c: Ctx, i: { bands: { upTo: string; rate: string }[]; pensionEmployeePct: number; pensionEmployerPct: number; nhfPct: number; nsitfPct: number; rentReliefPct: number; rentReliefCap: string; maxDiscretionaryPct: number; verifiedBy?: string; note?: string }) {
  need(c, 'payroll:configure');
  const bands = i.bands.filter((b) => b.rate !== '').map((b) => ({ upTo: b.upTo.trim() === '' ? null : money(b.upTo), rate: Number(b.rate) / 100 }));
  if (bands.length === 0 || bands.some((b) => !(b.rate >= 0 && b.rate <= 1))) throw new UserError('Enter at least one tax band with a rate between 0 and 100%.');
  for (let k = 1; k < bands.length; k++) if (bands[k - 1].upTo === null || (bands[k].upTo !== null && bands[k].upTo! <= bands[k - 1].upTo!)) throw new UserError('Bands must be in increasing order, and only the last band can have no upper limit.');
  if (bands[bands.length - 1].upTo !== null) throw new UserError('The last band must have no upper limit.');
  for (const [n, v, max] of [['Employee pension', i.pensionEmployeePct, 30], ['Employer pension', i.pensionEmployerPct, 30], ['NHF', i.nhfPct, 10], ['NSITF', i.nsitfPct, 10], ['Rent relief', i.rentReliefPct, 100], ['Maximum discretionary deductions', i.maxDiscretionaryPct, 100]] as const)
    if (!(v >= 0 && v <= max)) throw new UserError(`${n} must be between 0 and ${max}%.`);
  const before = await getSettings(c.q);
  await c.q.query(
    `insert into payroll_settings (org_id, tax_bands, pension_employee_pct, pension_employer_pct, nhf_pct, nsitf_employer_pct, rent_relief_pct, rent_relief_cap, max_discretionary_pct, regime_note, verified_by, verified_on, updated_by, updated_at)
     values ($1,$2::jsonb,$3,$4,$5,$6,$7,$8,$9,$10,$11,case when $11::text is null then null else current_date end,$12, now())
     on conflict (org_id) do update set tax_bands = excluded.tax_bands, pension_employee_pct = excluded.pension_employee_pct, pension_employer_pct = excluded.pension_employer_pct, nhf_pct = excluded.nhf_pct, nsitf_employer_pct = excluded.nsitf_employer_pct,
       rent_relief_pct = excluded.rent_relief_pct, rent_relief_cap = excluded.rent_relief_cap, max_discretionary_pct = excluded.max_discretionary_pct, regime_note = excluded.regime_note, verified_by = excluded.verified_by, verified_on = excluded.verified_on, updated_by = excluded.updated_by, updated_at = now()`,
    [c.orgId, JSON.stringify(bands), i.pensionEmployeePct, i.pensionEmployerPct, i.nhfPct, i.nsitfPct, i.rentReliefPct, toDb(money(i.rentReliefCap)), i.maxDiscretionaryPct, i.note || null, i.verifiedBy?.trim() || null, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'payroll.settings_saved', entity: 'payroll_settings', before: before.saved ? { bands: before.settings.bands, pension: before.settings.pensionEmployeePct } : null, after: { bands, verifiedBy: i.verifiedBy ?? null }, ip: c.ip, userAgent: c.userAgent });
}

export async function getPolicies(q: Q) {
  const rows = await q.query<any>('select * from fine_policies');
  const by = (k: string) => rows.find((r) => r.kind === k);
  const mapP = (r: any, kind: 'lateness' | 'absence') => ({ kind, exists: !!r, freePerMonth: r?.free_per_month ?? 3, perIncident: fromDb(r?.amount_per_incident ?? 0), perMinute: fromDb(r?.amount_per_minute ?? 0), monthlyCap: r?.monthly_cap != null ? fromDb(r.monthly_cap) : null, dailyRatePct: Number(r?.daily_rate_pct ?? 100), legalBasis: r?.legal_basis ?? '', active: !!r?.active });
  return { lateness: mapP(by('lateness'), 'lateness'), absence: mapP(by('absence'), 'absence') };
}

export async function savePolicy(c: Ctx, i: { kind: 'lateness' | 'absence'; freePerMonth: number; perIncident: string; perMinute: string; monthlyCap: string; dailyRatePct: number; legalBasis: string; active: boolean }) {
  need(c, 'payroll:configure');
  if (i.active && i.legalBasis.trim().length < 10) throw new UserError('Before switching a fine on, record its legal basis: the clause of the employment contract, handbook or collective agreement that authorises the deduction.');
  const m = (s: string) => (s.trim() === '' || s.trim() === '0' ? 0 : money(s));
  await c.q.query(
    `insert into fine_policies (org_id, kind, free_per_month, amount_per_incident, amount_per_minute, monthly_cap, daily_rate_pct, legal_basis, active, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
     on conflict (org_id, kind) do update set free_per_month = excluded.free_per_month, amount_per_incident = excluded.amount_per_incident, amount_per_minute = excluded.amount_per_minute, monthly_cap = excluded.monthly_cap, daily_rate_pct = excluded.daily_rate_pct, legal_basis = excluded.legal_basis, active = excluded.active, updated_at = now()`,
    [c.orgId, i.kind, i.freePerMonth, toDb(m(i.perIncident)), toDb(m(i.perMinute)), i.monthlyCap.trim() === '' ? null : toDb(m(i.monthlyCap)), i.dailyRatePct, i.legalBasis.trim(), i.active]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'payroll.fine_policy_saved', entity: 'fine_policy', entityId: i.kind, after: { ...i }, ip: c.ip, userAgent: c.userAgent });
}

// ---- Compensation -----------------------------------------------------------------------------------------------------------------
export async function setCompensation(c: Ctx, employeeId: string, i: { basic: string; housing: string; transport: string; others: { name: string; amount: string }[]; pension: boolean; nhf: boolean; annualRent: string; taxId?: string; pensionPin?: string; bankName?: string; bankAccount?: string; effectiveFrom: string }) {
  need(c, 'payroll:manage');
  if (!(await c.q.query('select 1 from employees where id = $1', [employeeId]))[0]) throw new UserError('Unknown employee.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.effectiveFrom)) throw new UserError('Enter the date these amounts take effect.');
  const m0 = (s: string) => (s.trim() === '' || s.trim() === '0' ? 0 : money(s));
  const basic = money(i.basic);
  const others = i.others.filter((o) => o.name.trim() && o.amount.trim()).map((o) => ({ name: o.name.trim(), amount: toDb(money(o.amount)) }));
  const prev = (await c.q.query<any>('select id, effective_from::text as ef, basic from comp_profiles where employee_id = $1 and effective_to is null', [employeeId]))[0];
  if (prev && i.effectiveFrom <= prev.ef) throw new UserError(`The new amounts must take effect after ${prev.ef}, when the current ones began. History is never overwritten.`);
  if (prev) await c.q.query('update comp_profiles set effective_to = $2 where id = $1', [prev.id, i.effectiveFrom]);
  const r = await c.q.query<{ id: string }>(
    `insert into comp_profiles (org_id, employee_id, basic, housing, transport, other_allowances, pension_enabled, nhf_enabled, annual_rent, tax_id, pension_pin, bank_name, bank_account, effective_from, created_by)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
    [c.orgId, employeeId, toDb(basic), toDb(m0(i.housing)), toDb(m0(i.transport)), JSON.stringify(others), i.pension, i.nhf, toDb(m0(i.annualRent)), seal(i.taxId), seal(i.pensionPin), i.bankName?.trim() || null, seal(i.bankAccount), i.effectiveFrom, c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'payroll.compensation_set', entity: 'employee', entityId: employeeId, before: prev ? { basic: prev.basic } : null, after: { basic: toDb(basic), effectiveFrom: i.effectiveFrom }, ip: c.ip, userAgent: c.userAgent });
  return r[0].id;
}

function mapComp(r: any): Compensation & { grossFixed: number } {
  const others = ((r.other_allowances ?? []) as { name: string; amount: string }[]).map((o) => ({ name: o.name, amount: fromDb(o.amount) }));
  const c: Compensation = { basic: fromDb(r.basic), housing: fromDb(r.housing), transport: fromDb(r.transport), others, pensionEnabled: r.pension_enabled, nhfEnabled: r.nhf_enabled, annualRent: fromDb(r.annual_rent) };
  return { ...c, grossFixed: c.basic + c.housing + c.transport + others.reduce((s, o) => s + o.amount, 0) };
}

export async function compensationOverview(c: Ctx) {
  need(c, 'payroll:view');
  const rows = await c.q.query<any>(
    `select e.id, e.full_name, e.employee_no, d.name as department, cp.basic, cp.housing, cp.transport, cp.other_allowances, cp.effective_from::text as ef, cp.bank_name, cp.pension_enabled
       from employees e left join assignments a on a.employee_id = e.id and ${CUR} left join departments d on d.id = a.department_id
       left join comp_profiles cp on cp.employee_id = e.id and cp.effective_from <= current_date and (cp.effective_to is null or cp.effective_to > current_date)
      where e.status in ('active','on_leave') order by e.full_name`);
  return rows.map((r) => ({ id: r.id, name: r.full_name, no: r.employee_no, department: r.department, has: r.basic != null, gross: r.basic != null ? mapComp(r).grossFixed : 0, since: r.ef, bank: r.bank_name }));
}

export async function compensationFor(c: Ctx, employeeId: string) {
  need(c, 'payroll:view');
  const cur = (await c.q.query<any>(`select * from comp_profiles where employee_id = $1 and effective_to is null`, [employeeId]))[0];
  const full = can(c.subject, 'payroll:manage').allow; // only payroll managers see full identifiers; everyone else sees the last four characters
  if (full && cur && (cur.bank_account || cur.tax_id || cur.pension_pin)) await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'payroll.sensitive_viewed', entity: 'employee', entityId: employeeId, ip: c.ip, userAgent: c.userAgent });
  const hist = await c.q.query<any>('select basic, housing, transport, effective_from::text as ef, effective_to::text as et from comp_profiles where employee_id = $1 order by effective_from desc', [employeeId]);
  return { cur: cur ? { ...mapComp(cur), taxId: full ? unseal(cur.tax_id) : mask(cur.tax_id), pensionPin: full ? unseal(cur.pension_pin) : mask(cur.pension_pin), bankName: cur.bank_name, bankAccount: full ? unseal(cur.bank_account) : mask(cur.bank_account), effectiveFrom: d10(cur.effective_from) } : null, hist };
}

// ---- Fines and adjustments -----------------------------------------------------------------------------------------------------------
async function compAt(q: Q, employeeId: string, date: string) {
  const r = (await q.query<any>('select * from comp_profiles where employee_id = $1 and effective_from <= $2::date and (effective_to is null or effective_to > $2::date)', [employeeId, date]))[0];
  return r ? mapComp(r) : null;
}

/** Scan attendance for the month and PROPOSE fines under the active policies. Nothing is deducted until HR approves each one. */
export async function proposeFines(c: Ctx, period: string) {
  need(c, 'payroll:manage');
  if (!periodRe.test(period)) throw new UserError('Choose a month.');
  const { from, to } = monthRange(period);
  const pol = await getPolicies(c.q);
  const emps = await c.q.query<{ id: string }>(`select id from employees where status in ('active','on_leave') and not hidden`);
  const made = { lateness: 0, absence: 0, skipped: [] as string[] };
  const today = localParts(new Date(), (await c.q.query<{ timezone: string }>('select timezone from organizations where id = $1', [c.orgId]))[0].timezone).date;
  for (const e of emps) {
    // lateness
    if (pol.lateness.active && pol.lateness.exists) {
      const lates = await c.q.query<any>(
        `select s.work_date::text as d, s.late_minutes as m from attendance_sessions s
          where s.employee_id = $1 and s.work_date between $2::date and $3::date and s.late_minutes > 0
            and not exists (select 1 from attendance_exceptions x where x.employee_id = s.employee_id and x.work_date = s.work_date and x.kind in ('late','cannot_clock_in','field','remote','alt_location') and x.status = 'approved')`, [e.id, from, to]);
      const f = latenessFines(lates.map((l) => ({ date: l.d, minutes: l.m })), { freePerMonth: pol.lateness.freePerMonth, perIncident: pol.lateness.perIncident, perMinute: pol.lateness.perMinute, monthlyCap: pol.lateness.monthlyCap });
      if (f.total > 0) {
        const detail = f.items.map((i) => ({ label: `${i.date}: ${i.minutes} min late`, amount: toDb(i.amount) }));
        const ex = (await c.q.query<any>(`select id, status from pay_adjustments where employee_id = $1 and period = $2 and source_type = 'lateness'`, [e.id, period]))[0];
        if (!ex) { await c.q.query(`insert into pay_adjustments (org_id, employee_id, period, kind, amount, reason, source_type, source_ref, detail, proposed_by) values ($1,$2,$3,'fine',$4,$5,'lateness','auto',$6::jsonb,$7)`, [c.orgId, e.id, period, toDb(f.total), `Lateness: ${f.incidents} late arrival(s), first ${f.forgiven} forgiven`, JSON.stringify(detail), c.userId]); made.lateness++; }
        else if (ex.status === 'proposed') await c.q.query('update pay_adjustments set amount = $2, detail = $3::jsonb, reason = $4 where id = $1', [ex.id, toDb(f.total), JSON.stringify(detail), `Lateness: ${f.incidents} late arrival(s), first ${f.forgiven} forgiven`]);
      }
    }
    // unapproved absence on rostered days
    if (pol.absence.active && pol.absence.exists) {
      const comp = await compAt(c.q, e.id, to);
      if (!comp) continue;
      const days = await c.q.query<any>(
        `select r.work_date::text as d from roster_entries r where r.employee_id = $1 and r.status = 'published' and r.superseded_at is null and r.work_date between $2::date and $3::date and r.work_date < $4::date
            and not exists (select 1 from attendance_sessions s where s.employee_id = r.employee_id and s.work_date = r.work_date)
            and not exists (select 1 from leave_requests l where l.employee_id = r.employee_id and l.status = 'approved' and r.work_date between l.start_date and l.end_date)
            and not exists (select 1 from attendance_exceptions x where x.employee_id = r.employee_id and x.work_date = r.work_date and x.status = 'approved')`, [e.id, from, to, today]);
      const f = absenceFines(days.map((x) => x.d), Math.round(comp.grossFixed / workingDaysDivisor), pol.absence.dailyRatePct);
      if (f.total > 0) {
        const detail = f.items.map((i) => ({ label: `${i.date}: absent without approval`, amount: toDb(i.amount) }));
        const ex = (await c.q.query<any>(`select id, status from pay_adjustments where employee_id = $1 and period = $2 and source_type = 'absence'`, [e.id, period]))[0];
        if (!ex) { await c.q.query(`insert into pay_adjustments (org_id, employee_id, period, kind, amount, reason, source_type, source_ref, detail, proposed_by) values ($1,$2,$3,'fine',$4,$5,'absence','auto',$6::jsonb,$7)`, [c.orgId, e.id, period, toDb(f.total), `${f.items.length} unapproved absence(s)`, JSON.stringify(detail), c.userId]); made.absence++; }
        else if (ex.status === 'proposed') await c.q.query('update pay_adjustments set amount = $2, detail = $3::jsonb where id = $1', [ex.id, toDb(f.total), JSON.stringify(detail)]);
      }
    }
  }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'payroll.fines_proposed', entity: 'pay_adjustment', after: { period, ...made }, ip: c.ip, userAgent: c.userAgent });
  return made;
}

export async function addManualAdjustment(c: Ctx, i: { employeeId: string; period: string; kind: string; amount: string; reason: string }) {
  need(c, 'payroll:manage');
  if (!periodRe.test(i.period)) throw new UserError('Choose a month.');
  if (!['deduction', 'loan_repayment', 'bonus', 'allowance', 'overtime', 'fine'].includes(i.kind)) throw new UserError('Choose a type.');
  if (i.reason.trim().length < 10) throw new UserError('Give a clear reason (at least 10 characters). It appears on the payslip.');
  if (!(await c.q.query('select 1 from employees where id = $1', [i.employeeId]))[0]) throw new UserError('Unknown employee.');
  const r = await c.q.query<{ id: string }>(`insert into pay_adjustments (org_id, employee_id, period, kind, amount, reason, source_type, proposed_by) values ($1,$2,$3,$4,$5,$6,'manual',$7) returning id`, [c.orgId, i.employeeId, i.period, i.kind, toDb(money(i.amount)), i.reason.trim(), c.userId]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'payroll.adjustment_proposed', entity: 'pay_adjustment', entityId: r[0].id, after: i, ip: c.ip, userAgent: c.userAgent });
}

export async function decideAdjustment(c: Ctx, id: string, approve: boolean, note: string) {
  need(c, 'payroll:manage');
  const a = (await c.q.query<any>('select * from pay_adjustments where id = $1 for update', [id]))[0];
  if (!a || a.status !== 'proposed') throw new UserError('This item has already been decided.');
  if (!approve && note.trim().length < 5) throw new UserError('Give a reason for waiving this deduction. The employee can see it.');
  const debit = ['fine', 'deduction', 'loan_repayment'].includes(a.kind);
  if (approve && debit && a.source_type === 'manual' && a.proposed_by === c.userId) throw new UserError('Separation of duties: someone else must approve a manual deduction you proposed.');
  await c.q.query(`update pay_adjustments set status = $2, decided_by = $3, decided_at = now(), decision_note = $4 where id = $1`, [id, approve ? 'approved' : 'waived', c.userId, note.trim() || null]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: approve ? 'payroll.adjustment_approved' : 'payroll.adjustment_waived', entity: 'pay_adjustment', entityId: id, reason: note || undefined, ip: c.ip, userAgent: c.userAgent });
}

export async function listAdjustments(c: Ctx, period: string) {
  need(c, 'payroll:view');
  return c.q.query<any>(
    `select a.id, a.kind, a.amount, a.reason, a.source_type, a.status, a.detail, a.decision_note, e.full_name from pay_adjustments a join employees e on e.id = a.employee_id where a.period = $1 order by a.status = 'proposed' desc, e.full_name, a.created_at`, [period]);
}

// ---- Runs ------------------------------------------------------------------------------------------------------------------------------------
export async function createRun(c: Ctx, period: string) {
  need(c, 'payroll:manage');
  if (!periodRe.test(period)) throw new UserError('Choose a month.');
  const { to } = monthRange(period);
  const today = localParts(new Date(), (await c.q.query<{ timezone: string }>('select timezone from organizations where id = $1', [c.orgId]))[0].timezone).date;
  if (period > today.slice(0, 7)) throw new UserError('You cannot prepare payroll for a future month.');
  if ((await c.q.query(`select 1 from pay_runs where period = $1 and status <> 'cancelled'`, [period]))[0]) throw new UserError('A payroll run already exists for this month. Cancel the draft to prepare it again.');
  const { settings, saved } = await getSettings(c.q);
  if (!saved) throw new UserError('Review and save the payroll settings (tax bands and statutory rates) before preparing payroll.');
  const emps = await c.q.query<any>(
    `select e.id, e.full_name, e.employee_no, d.id as dept_id, d.name as department, p.name as position from employees e
       left join assignments a on a.employee_id = e.id and a.superseded_at is null and a.kind = 'substantive' and a.valid_from <= $1::date and (a.valid_to is null or a.valid_to > $1::date)
       left join departments d on d.id = a.department_id left join positions p on p.id = a.position_id
      where e.status in ('active','on_leave') and not e.hidden and e.joined_on <= $1::date order by e.full_name`, [to]);
  const run = (await c.q.query<{ id: string }>(`insert into pay_runs (org_id, period, prepared_by) values ($1,$2,$3) returning id`, [c.orgId, period, c.userId]))[0].id;
  const totals = { gross: 0, net: 0, paye: 0, pensionEmp: 0, pensionEr: 0, nhf: 0, nsitf: 0, fines: 0, other: 0, employees: 0 };
  const missing: string[] = [];
  for (const e of emps) {
    const comp = await compAt(c.q, e.id, to);
    if (!comp) { missing.push(e.full_name); continue; }
    const adj = await c.q.query<any>(`select * from pay_adjustments where employee_id = $1 and period <= $2 and status in ('approved','deferred') order by period, created_at`, [e.id, period]);
    const credits: Credit[] = adj.filter((a) => ['bonus', 'allowance', 'overtime'].includes(a.kind)).map((a) => ({ label: a.reason, amount: fromDb(a.amount), kind: a.kind }));
    const debits: Debit[] = adj.filter((a) => ['fine', 'deduction', 'loan_repayment'].includes(a.kind)).map((a) => ({ id: a.id, label: a.kind === 'fine' ? `Fine: ${a.reason}` : a.reason, amount: fromDb(a.amount), kind: a.kind, detail: ((a.detail ?? []) as { label: string; amount: string }[]).map((x) => ({ label: x.label, amount: fromDb(x.amount) })) }));
    const r = computePayslip(comp, credits, debits, settings);
    const bank = (await c.q.query<any>('select bank_name, bank_account, tax_id, pension_pin from comp_profiles where employee_id = $1 and effective_to is null', [e.id]))[0] ?? {};
    await c.q.query(
      `insert into payslips (org_id, run_id, employee_id, period, gross, total_deductions, net, details, employee_snapshot) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)`,
      [c.orgId, run, e.id, period, toDb(r.gross), toDb(r.totalDeductions), toDb(r.net), JSON.stringify({ ...r, appliedIds: r.deductions.map((d) => d.id).filter(Boolean), creditIds: adj.filter((a) => ['bonus', 'allowance', 'overtime'].includes(a.kind)).map((a) => a.id), deferredIds: r.deferred.map((d) => d.id) }),
        JSON.stringify({ name: e.full_name, number: e.employee_no, departmentId: e.dept_id, department: e.department, position: e.position, bankName: bank.bank_name ?? null, bankAccount: mask(bank.bank_account), taxId: mask(bank.tax_id), pensionPin: mask(bank.pension_pin) })]);
    totals.gross += r.gross; totals.net += r.net; totals.employees++;
    totals.paye += r.deductions.find((d) => d.label.startsWith('PAYE'))?.amount ?? 0;
    totals.pensionEmp += r.deductions.find((d) => d.label.startsWith('Pension'))?.amount ?? 0;
    totals.nhf += r.deductions.find((d) => d.label.startsWith('National Housing'))?.amount ?? 0;
    totals.fines += r.deductions.filter((d) => d.kind === 'fine').reduce((a, d) => a + d.amount, 0);
    totals.other += r.deductions.filter((d) => ['deduction', 'loan_repayment'].includes(d.kind)).reduce((a, d) => a + d.amount, 0);
    totals.pensionEr += r.employer.find((x) => x.label.includes('Pension'))?.amount ?? 0;
    totals.nsitf += r.employer.find((x) => x.label.startsWith('NSITF'))?.amount ?? 0;
  }
  await c.q.query('update pay_runs set totals = $2::jsonb where id = $1', [run, JSON.stringify({ ...totals, missingCompensation: missing })]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'payroll.run_prepared', entity: 'pay_run', entityId: run, after: { period, employees: totals.employees, gross: toDb(totals.gross), missing: missing.length }, ip: c.ip, userAgent: c.userAgent });
  return { id: run, employees: totals.employees, missing };
}

export async function cancelRun(c: Ctx, id: string, reason: string) {
  need(c, 'payroll:manage');
  const r = (await c.q.query<any>('select * from pay_runs where id = $1 for update', [id]))[0];
  if (!r || r.status !== 'draft') throw new UserError('Only draft runs can be cancelled.');
  if (reason.trim().length < 5) throw new UserError('Give a reason.');
  await c.q.query('delete from payslips where run_id = $1', [id]); // unpublished drafts only (the database refuses to delete published ones)
  await c.q.query(`update pay_runs set status = 'cancelled' where id = $1`, [id]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'payroll.run_cancelled', entity: 'pay_run', entityId: id, reason, ip: c.ip, userAgent: c.userAgent });
}

export async function approveRun(c: Ctx, id: string) {
  need(c, 'payroll:approve');
  const r = (await c.q.query<any>('select * from pay_runs where id = $1 for update', [id]))[0];
  if (!r || r.status !== 'draft') throw new UserError('This run is not waiting for approval.');
  if (r.prepared_by === c.userId) throw new UserError('Separation of duties: you prepared this payroll, so someone else must approve it.');
  const slips = await c.q.query<any>('select * from payslips where run_id = $1', [id]);
  if (slips.length === 0) throw new UserError('This run has no payslips.');
  const [staff, salaries, paye, pension, statutory, otherDed, income] = await Promise.all([
    ensureAccount(c.q, c.orgId, '5050', 'Staff costs', 'expense'), ensureAccount(c.q, c.orgId, '2100', 'Salaries payable', 'liability'), ensureAccount(c.q, c.orgId, '2110', 'PAYE payable', 'liability'),
    ensureAccount(c.q, c.orgId, '2120', 'Pension payable', 'liability'), ensureAccount(c.q, c.orgId, '2130', 'NHF and NSITF payable', 'liability'), ensureAccount(c.q, c.orgId, '2140', 'Staff deductions payable', 'liability'), ensureAccount(c.q, c.orgId, '4900', 'Other income', 'income'),
  ]);
  const t = r.totals as Record<string, number>;
  const byDept = new Map<string | null, number>();
  for (const s of slips) {
    const d = (s.employee_snapshot.departmentId as string | null) ?? null;
    const det = s.details;
    const er = (det.employer as { amount: number }[]).reduce((a, x) => a + x.amount, 0);
    byDept.set(d, (byDept.get(d) ?? 0) + fromDb(s.gross) + er);
  }
  const lines: Line[] = [...byDept].map(([dept, amt]) => ({ accountId: staff, debit: amt, credit: 0, departmentId: dept }));
  const credit = (accountId: string, amount: number) => { if (amount > 0) lines.push({ accountId, debit: 0, credit: amount }); };
  credit(salaries, t.net); credit(paye, t.paye); credit(pension, t.pensionEmp + t.pensionEr); credit(statutory, t.nhf + t.nsitf); credit(otherDed, t.other); credit(income, t.fines);
  const date = monthRange(r.period).to;
  const entry = await postEntry(c.q, c.orgId, c.userId, { date, memo: `Payroll ${r.period}`, sourceType: 'manual', lines });
  await c.q.query(`update pay_runs set status = 'approved', approved_by = $2, approved_at = now(), accrual_entry_id = $3 where id = $1`, [id, c.userId, entry.id]);
  await c.q.query('update payslips set published = true where run_id = $1', [id]);
  for (const s of slips) {
    const ids = [...(s.details.appliedIds ?? []), ...(s.details.creditIds ?? [])] as string[];
    if (ids.length) await c.q.query(`update pay_adjustments set status = 'applied', applied_run_id = $2 where id = any($1::uuid[])`, [ids, id]);
    const def = (s.details.deferredIds ?? []) as string[];
    if (def.length) await c.q.query(`update pay_adjustments set status = 'deferred' where id = any($1::uuid[])`, [def]);
    const u = (await c.q.query<{ user_id: string | null }>('select user_id from employees where id = $1', [s.employee_id]))[0]?.user_id;
    if (u) await notify(c.q, c.orgId, u, `Your ${r.period} payslip is ready`, 'Open Payslips to view or print it.', `/payslips/${s.id}`);
  }
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'payroll.run_approved', entity: 'pay_run', entityId: id, after: { period: r.period, employees: slips.length, entryNo: entry.entryNo }, ip: c.ip, userAgent: c.userAgent });
}

export async function payRun(c: Ctx, id: string, i: { cashAccountId: string; reference: string }) {
  need(c, 'payroll:pay');
  const r = (await c.q.query<any>('select * from pay_runs where id = $1 for update', [id]))[0];
  if (!r || r.status !== 'approved') throw new UserError('Only approved payroll can be paid.');
  if ([r.prepared_by, r.approved_by].includes(c.userId)) throw new UserError('Separation of duties: you prepared or approved this payroll, so someone else must record the payment.');
  if (!i.reference.trim()) throw new UserError('Enter the bank payment reference or batch number.');
  const acct = (await c.q.query<any>('select id, name, is_cash from fin_accounts where id = $1 and active', [i.cashAccountId]))[0];
  if (!acct?.is_cash) throw new UserError('Choose the bank or cash account the salaries are paid from.');
  const net = (r.totals as Record<string, number>).net;
  if ((await cashBalance(c.q, acct.id)) < net) throw new UserError(`Insufficient funds in ${acct.name} for a net payroll of ${formatMoney(net)}.`);
  const salaries = await ensureAccount(c.q, c.orgId, '2100', 'Salaries payable', 'liability');
  const entry = await postEntry(c.q, c.orgId, c.userId, { date: new Date().toISOString().slice(0, 10), memo: `Salaries paid ${r.period}`, sourceType: 'manual', lines: [{ accountId: salaries, debit: net, credit: 0 }, { accountId: acct.id, debit: 0, credit: net }] });
  await c.q.query(`update pay_runs set status = 'paid', paid_by = $2, paid_at = now(), payment_ref = $3, payment_entry_id = $4 where id = $1`, [id, c.userId, i.reference.trim(), entry.id]);
  await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'payroll.run_paid', entity: 'pay_run', entityId: id, after: { account: acct.name, reference: i.reference, net: toDb(net) }, ip: c.ip, userAgent: c.userAgent });
}

export async function listRuns(c: Ctx) {
  need(c, 'payroll:view');
  return c.q.query<any>(`select r.id, r.period, r.status, r.totals, pu.email as prepared_by, au.email as approved_by from pay_runs r left join users pu on pu.id = r.prepared_by left join users au on au.id = r.approved_by order by r.period desc limit 36`);
}

export async function getRun(c: Ctx, id: string) {
  need(c, 'payroll:view');
  const r = (await c.q.query<any>(`select r.*, pu.email as prepared_email, au.email as approved_email, xu.email as paid_email from pay_runs r left join users pu on pu.id = r.prepared_by left join users au on au.id = r.approved_by left join users xu on xu.id = r.paid_by where r.id = $1`, [id]))[0];
  if (!r) return null;
  const slips = await c.q.query<any>(`select id, employee_id, gross, total_deductions, net, published, employee_snapshot from payslips where run_id = $1 order by employee_snapshot->>'name'`, [id]);
  return { run: r, slips };
}

// ---- Employee-facing ---------------------------------------------------------------------------------------------------------------------------
export async function myPayslips(c: Ctx) {
  need(c, 'payslip:view:own');
  const emp = (await c.q.query<{ id: string }>('select id from employees where user_id = $1', [c.userId]))[0];
  if (!emp) return [];
  return (await c.q.query<any>(`select id, period, gross, total_deductions, net from payslips where employee_id = $1 and published order by period desc`, [emp.id]))
    .map((r) => ({ id: r.id, period: r.period, gross: fromDb(r.gross), deductions: fromDb(r.total_deductions), net: fromDb(r.net) }));
}

export async function getPayslip(c: Ctx, id: string) {
  const s = (await c.q.query<any>(`select p.*, e.user_id from payslips p join employees e on e.id = p.employee_id where p.id = $1`, [id]))[0];
  if (!s) return null;
  const mine = s.user_id === c.userId;
  if (mine) need(c, 'payslip:view:own');
  else need(c, 'payroll:view');
  if (mine && !s.published) return null;
  if (!mine) await audit(c.q, { orgId: c.orgId, actorUserId: c.userId, action: 'payroll.payslip_viewed', entity: 'payslip', entityId: id, ip: c.ip, userAgent: c.userAgent });
  const org = (await c.q.query<any>('select name, currency, locale from organizations where id = $1', [c.orgId]))[0];
  return { id: s.id, period: s.period, gross: fromDb(s.gross), totalDeductions: fromDb(s.total_deductions), net: fromDb(s.net), details: s.details as import('../domain/payroll').PayslipResult, employee: s.employee_snapshot as Record<string, any>, org, mine };
}

export const canSeeAllPayroll = (c: Ctx) => can(c.subject, 'payroll:view').allow;
