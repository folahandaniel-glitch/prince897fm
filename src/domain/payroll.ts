/**
 * Pure payroll calculation. All amounts are integer minor units (kobo).
 * Statutory rates, tax bands and deduction limits are INPUT DATA (payroll_settings), never constants, because they change
 * with the law and must be confirmed by a qualified accountant. Defaults below are starting values only.
 */

export interface TaxBand { upTo: number | null; rate: number } // upTo = cumulative annual taxable income ceiling in minor units; null = no ceiling

export interface PayrollSettings {
  bands: TaxBand[];
  pensionEmployeePct: number; pensionEmployerPct: number; nhfPct: number; nsitfPct: number;
  rentReliefPct: number; rentReliefCap: number; maxDiscretionaryPct: number;
}

/** Starting values for Nigeria (annual naira bands expressed in kobo). MUST be verified against current law before payroll goes live. */
export const DEFAULT_SETTINGS: PayrollSettings = {
  bands: [
    { upTo: 800_000_00, rate: 0 }, { upTo: 3_000_000_00, rate: 0.15 }, { upTo: 12_000_000_00, rate: 0.18 },
    { upTo: 25_000_000_00, rate: 0.21 }, { upTo: 50_000_000_00, rate: 0.23 }, { upTo: null, rate: 0.25 },
  ],
  pensionEmployeePct: 8, pensionEmployerPct: 10, nhfPct: 2.5, nsitfPct: 1,
  rentReliefPct: 20, rentReliefCap: 500_000_00, maxDiscretionaryPct: 50,
};

export interface Compensation {
  basic: number; housing: number; transport: number; others: { name: string; amount: number }[];
  pensionEnabled: boolean; nhfEnabled: boolean; annualRent: number;
}
export interface Credit { label: string; amount: number; kind: string }
export interface Debit { id: string; label: string; amount: number; kind: string; detail?: { label: string; amount: number }[] }

const pct = (amount: number, p: number) => Math.round((amount * p) / 100);

export function applyBands(taxable: number, bands: TaxBand[]): number {
  let tax = 0, floor = 0;
  for (const b of bands) {
    const ceil = b.upTo ?? Infinity;
    if (taxable > floor) tax += (Math.min(taxable, ceil) - floor) * b.rate;
    floor = ceil;
    if (taxable <= ceil) break;
  }
  return Math.round(tax);
}

export interface PayslipResult {
  earnings: { label: string; amount: number }[];
  gross: number;
  deductions: { label: string; amount: number; kind: string; detail?: { label: string; amount: number }[]; id?: string }[];
  totalDeductions: number;
  net: number;
  employer: { label: string; amount: number }[];
  deferred: Debit[];
  tax: { annualGross: number; reliefs: number; rentRelief: number; taxable: number; annualTax: number };
}

export function computePayslip(comp: Compensation, credits: Credit[], debits: Debit[], s: PayrollSettings): PayslipResult {
  const earnings = [
    { label: 'Basic salary', amount: comp.basic }, { label: 'Housing allowance', amount: comp.housing }, { label: 'Transport allowance', amount: comp.transport },
    ...comp.others.filter((o) => o.amount > 0).map((o) => ({ label: o.name, amount: o.amount })),
    ...credits.map((c) => ({ label: c.label, amount: c.amount })),
  ].filter((e) => e.amount > 0);
  const gross = earnings.reduce((a, e) => a + e.amount, 0);

  const pensionBase = comp.basic + comp.housing + comp.transport;
  const pensionEmp = comp.pensionEnabled ? pct(pensionBase, s.pensionEmployeePct) : 0;
  const pensionEr = comp.pensionEnabled ? pct(pensionBase, s.pensionEmployerPct) : 0;
  const nhf = comp.nhfEnabled ? pct(comp.basic, s.nhfPct) : 0;
  const rentRelief = Math.min(pct(comp.annualRent, s.rentReliefPct), s.rentReliefCap);

  const annualGross = gross * 12;
  const reliefs = (pensionEmp + nhf) * 12 + rentRelief;
  const taxable = Math.max(0, annualGross - reliefs);
  const annualTax = applyBands(taxable, s.bands);
  const paye = Math.round(annualTax / 12);

  const statutory: PayslipResult['deductions'] = [
    ...(paye > 0 ? [{ label: 'PAYE (income tax)', amount: paye, kind: 'statutory' }] : []),
    ...(pensionEmp > 0 ? [{ label: `Pension (employee ${s.pensionEmployeePct}%)`, amount: pensionEmp, kind: 'statutory' }] : []),
    ...(nhf > 0 ? [{ label: `National Housing Fund (${s.nhfPct}%)`, amount: nhf, kind: 'statutory' }] : []),
  ];
  const statutoryTotal = statutory.reduce((a, d) => a + d.amount, 0);

  // Discretionary deductions (fines, loan repayments, other) are limited so pay is never driven below the legal/policy floor.
  const capByPct = Math.floor((gross * s.maxDiscretionaryPct) / 100);
  let room = Math.max(0, Math.min(capByPct, gross - statutoryTotal));
  const applied: PayslipResult['deductions'] = [], deferred: Debit[] = [];
  for (const d of debits) {
    if (d.amount <= room) { applied.push({ label: d.label, amount: d.amount, kind: d.kind, detail: d.detail, id: d.id }); room -= d.amount; }
    else deferred.push(d); // carried to the next payslip rather than taking more than the limit
  }
  const deductions = [...statutory, ...applied];
  const totalDeductions = deductions.reduce((a, d) => a + d.amount, 0);
  const employer = [
    ...(pensionEr > 0 ? [{ label: `Pension (employer ${s.pensionEmployerPct}%)`, amount: pensionEr }] : []),
    ...(s.nsitfPct > 0 ? [{ label: `NSITF (employer ${s.nsitfPct}%)`, amount: pct(gross, s.nsitfPct) }] : []),
  ];
  return { earnings, gross, deductions, totalDeductions, net: gross - totalDeductions, employer, deferred, tax: { annualGross, reliefs, rentRelief, taxable, annualTax } };
}

// ---- Fines ------------------------------------------------------------------------------------------------------------------
export interface LatePolicy { freePerMonth: number; perIncident: number; perMinute: number; monthlyCap: number | null }

/** Lateness fines: the first `freePerMonth` late arrivals are forgiven; the rest are fined, up to the monthly cap. */
export function latenessFines(lates: { date: string; minutes: number }[], p: LatePolicy) {
  const sorted = [...lates].sort((a, b) => a.date.localeCompare(b.date));
  const items: { date: string; minutes: number; amount: number }[] = [];
  let total = 0;
  for (const [i, l] of sorted.entries()) {
    if (i < p.freePerMonth) continue;
    let amount = p.perIncident + p.perMinute * l.minutes;
    if (p.monthlyCap !== null) amount = Math.min(amount, Math.max(0, p.monthlyCap - total));
    if (amount <= 0) continue;
    items.push({ date: l.date, minutes: l.minutes, amount }); total += amount;
  }
  return { items, total, forgiven: Math.min(p.freePerMonth, sorted.length), incidents: sorted.length };
}

export function absenceFines(days: string[], dailyGross: number, dailyRatePct: number) {
  const each = pct(dailyGross, dailyRatePct);
  const items = days.map((d) => ({ date: d, amount: each })).filter((i) => i.amount > 0);
  return { items, total: items.reduce((a, i) => a + i.amount, 0) };
}

export const workingDaysDivisor = 22; // default divisor for a daily rate; configurable later
