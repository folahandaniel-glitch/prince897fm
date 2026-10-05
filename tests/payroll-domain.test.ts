import { describe, expect, it } from 'vitest';
import { absenceFines, applyBands, computePayslip, DEFAULT_SETTINGS, latenessFines, type Compensation } from '../src/domain/payroll';

const N = (v: number) => v * 100; // naira -> kobo
const comp: Compensation = { basic: N(300_000), housing: N(100_000), transport: N(50_000), others: [], pensionEnabled: true, nhfEnabled: false, annualRent: 0 };

describe('tax bands', () => {
  it('applies progressive bands exactly', () => {
    expect(applyBands(N(500_000), DEFAULT_SETTINGS.bands)).toBe(0);
    expect(applyBands(N(3_000_000), DEFAULT_SETTINGS.bands)).toBe(N(330_000));           // 2.2M at 15%
    expect(applyBands(N(4_968_000), DEFAULT_SETTINGS.bands)).toBe(N(330_000) + Math.round(N(1_968_000) * 0.18));
    expect(applyBands(0, DEFAULT_SETTINGS.bands)).toBe(0);
  });
});

describe('payslip calculation', () => {
  const r = computePayslip(comp, [], [], DEFAULT_SETTINGS);
  it('computes gross, pension and PAYE consistently', () => {
    expect(r.gross).toBe(N(450_000));
    const pension = r.deductions.find((d) => d.label.startsWith('Pension'))!.amount;
    expect(pension).toBe(N(36_000));                                     // 8% of basic+housing+transport
    const annualTaxable = N(450_000) * 12 - N(36_000) * 12;
    const paye = r.deductions.find((d) => d.label.startsWith('PAYE'))!.amount;
    expect(paye).toBe(Math.round(applyBands(annualTaxable, DEFAULT_SETTINGS.bands) / 12));
    expect(r.net).toBe(r.gross - r.totalDeductions);
    expect(r.employer.find((e) => e.label.includes('employer'))!.amount).toBe(N(45_000)); // 10%
  });
  it('allows opting out of pension and adds NHF on basic', () => {
    const x = computePayslip({ ...comp, pensionEnabled: false, nhfEnabled: true }, [], [], DEFAULT_SETTINGS);
    expect(x.deductions.some((d) => d.label.startsWith('Pension'))).toBe(false);
    expect(x.deductions.find((d) => d.label.startsWith('National Housing'))!.amount).toBe(N(7_500));
  });
  it('rent relief reduces tax but is capped', () => {
    const base = computePayslip(comp, [], [], DEFAULT_SETTINGS).tax.taxable;
    const withRent = computePayslip({ ...comp, annualRent: N(10_000_000) }, [], [], DEFAULT_SETTINGS).tax;
    expect(withRent.rentRelief).toBe(N(500_000));                        // 20% would be 2M, capped at 500k
    expect(withRent.taxable).toBe(base - N(500_000));
  });
  it('shows fines as itemised deductions and reduces net pay', () => {
    const fine = { id: 'f1', label: 'Lateness fines (April)', amount: N(3_000), kind: 'fine', detail: [{ label: '12 Apr: 32 min late', amount: N(1_500) }, { label: '18 Apr: 10 min late', amount: N(1_500) }] };
    const x = computePayslip(comp, [], [fine], DEFAULT_SETTINGS);
    expect(x.deductions.find((d) => d.id === 'f1')!.detail).toHaveLength(2);
    expect(x.net).toBe(r.net - N(3_000));
  });
  it('never lets discretionary deductions exceed the configured share of gross; the rest is deferred', () => {
    const big = [{ id: 'a', label: 'Fine A', amount: N(200_000), kind: 'fine' }, { id: 'b', label: 'Fine B', amount: N(100_000), kind: 'fine' }];
    const x = computePayslip(comp, [], big, { ...DEFAULT_SETTINGS, maxDiscretionaryPct: 50 }); // 50% of 450k = 225k
    expect(x.deductions.some((d) => d.id === 'a')).toBe(true);
    expect(x.deductions.some((d) => d.id === 'b')).toBe(false);
    expect(x.deferred.map((d) => d.id)).toEqual(['b']);
    const y = computePayslip(comp, [], big, { ...DEFAULT_SETTINGS, maxDiscretionaryPct: 10 });
    expect(y.deferred).toHaveLength(2);
  });
  it('bonuses count as earnings and are taxed', () => {
    const x = computePayslip(comp, [{ label: 'Bonus', amount: N(50_000), kind: 'bonus' }], [], DEFAULT_SETTINGS);
    expect(x.gross).toBe(N(500_000));
    expect(x.earnings.some((e) => e.label === 'Bonus')).toBe(true);
  });
  it('never produces negative net pay', () => {
    const tiny: Compensation = { ...comp, basic: N(30_000), housing: 0, transport: 0 };
    const x = computePayslip(tiny, [], [{ id: 'z', label: 'Huge fine', amount: N(500_000), kind: 'fine' }], DEFAULT_SETTINGS);
    expect(x.net).toBeGreaterThanOrEqual(0);
  });
});

describe('fines', () => {
  const policy = { freePerMonth: 3, perIncident: N(1_000), perMinute: 0, monthlyCap: N(5_000) };
  it('forgives the first few lates, then fines, up to the cap', () => {
    const lates = Array.from({ length: 12 }, (_, i) => ({ date: `2026-04-${String(i + 1).padStart(2, '0')}`, minutes: 20 }));
    const r = latenessFines(lates, policy);
    expect(r.forgiven).toBe(3);
    expect(r.total).toBe(N(5_000));
    expect(r.items.length).toBe(5);
    expect(r.items[0].date).toBe('2026-04-04');
  });
  it('charges nothing within the free allowance', () => expect(latenessFines([{ date: '2026-04-01', minutes: 5 }], policy).total).toBe(0));
  it('supports per-minute fines', () => expect(latenessFines([{ date: 'a', minutes: 30 }], { freePerMonth: 0, perIncident: 0, perMinute: N(10), monthlyCap: null }).total).toBe(N(300)));
  it('absence deducts a share of a day\'s gross', () => expect(absenceFines(['2026-04-10', '2026-04-11'], N(22_000), 100).total).toBe(N(44_000)));
});
