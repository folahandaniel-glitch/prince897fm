import { describe, expect, it } from 'vitest';
import { ageingBucket, invoiceLines, parseBankCsv, settlementLines, splitCsv, suggestMatch, vatOn } from '../src/domain/invoices';
import { isBalanced } from '../src/domain/finance';
import { addMonths } from '../src/domain/training';
import { countDays, expandPattern, parsePattern } from '../src/domain/attendance';

const acc = { ar: 'ar', ap: 'ap', vatOut: 'vo', vatIn: 'vi', whtRecv: 'wr', whtPay: 'wp' };

describe('VAT', () => {
  it('rounds half up in integer kobo', () => {
    expect(vatOn(100_000_00, 7.5)).toBe(7_500_00);
    expect(vatOn(1, 7.5)).toBe(0); // 0.075 kobo
    expect(vatOn(10, 7.5)).toBe(1); // 0.75 kobo rounds up
    expect(vatOn(123_45, 0)).toBe(0);
  });
  it('rejects impossible rates', () => { expect(() => vatOn(100, -1)).toThrow(); expect(() => vatOn(100, 101)).toThrow(); });
});

describe('invoice journals always balance', () => {
  it('receivable and payable, with and without VAT', () => {
    for (const kind of ['receivable', 'payable'] as const) for (const vat of [0, 7_500_00]) {
      expect(isBalanced(invoiceLines({ kind, categoryId: 'cat', subtotal: 100_000_00, vat, acc }))).toBe(true);
    }
  });
  it('settlement with withholding tax balances and clears cash + wht from the control account', () => {
    for (const kind of ['receivable', 'payable'] as const) {
      const l = settlementLines({ kind, cashId: 'bank', cash: 95_000_00, wht: 5_000_00, acc });
      expect(isBalanced(l)).toBe(true);
      const control = l.find((x) => x.accountId === (kind === 'receivable' ? 'ar' : 'ap'))!;
      expect(control.credit + control.debit).toBe(100_000_00);
    }
    expect(isBalanced(settlementLines({ kind: 'receivable', cashId: 'bank', cash: 100, wht: 0, acc }))).toBe(true);
  });
});

describe('ageing buckets', () => {
  it('uses days past due', () => {
    expect(ageingBucket('2026-03-10', '2026-03-10')).toBe(0);
    expect(ageingBucket('2026-03-10', '2026-03-09')).toBe(0);
    expect(ageingBucket('2026-03-10', '2026-03-11')).toBe(1);
    expect(ageingBucket('2026-03-10', '2026-04-09')).toBe(1);
    expect(ageingBucket('2026-03-10', '2026-04-10')).toBe(2);
    expect(ageingBucket('2026-01-01', '2026-03-31')).toBe(3);
    expect(ageingBucket('2025-01-01', '2026-03-31')).toBe(4);
  });
});

describe('bank statement CSV', () => {
  it('reads debit/credit columns with Nigerian day-first dates and thousands separators', () => {
    const r = parseBankCsv('Date,Narration,Reference,Debit,Credit\n02/03/2026,"Transfer, vendor",GTB-1,"150,000.00",\n03-03-2026,Advert receipt,POS-9,,"25,000.50"');
    expect(r.errors).toEqual([]);
    expect(r.lines).toEqual([
      { date: '2026-03-02', description: 'Transfer, vendor', reference: 'GTB-1', amount: -150_000_00 },
      { date: '2026-03-03', description: 'Advert receipt', reference: 'POS-9', amount: 25_000_50 },
    ]);
  });
  it('reads a signed amount column and reports bad rows without failing the file', () => {
    const r = parseBankCsv('date,description,amount\n2026-03-02,A,(500.00)\n2026-13-45,B,10\n2026-03-04,C,abc\n2026-03-05,D,0');
    expect(r.lines).toEqual([{ date: '2026-03-02', description: 'A', reference: '', amount: -500_00 }]);
    expect(r.errors).toHaveLength(3);
  });
  it('explains a file it cannot understand', () => {
    expect(parseBankCsv('foo,bar\n1,2').errors[0]).toMatch(/columns/);
    expect(parseBankCsv('').errors[0]).toMatch(/header/);
  });
  it('splits quoted commas and escaped quotes', () => { expect(splitCsv('a,"b,""c""",d')).toEqual(['a', 'b,"c"', 'd']); });
});

describe('statement matching', () => {
  const cands = [
    { id: 'a', kind: 'txn' as const, date: '2026-03-02', amount: -100_00, ref: 'GTB-1' },
    { id: 'b', kind: 'txn' as const, date: '2026-03-03', amount: -100_00, ref: 'OTHER' },
    { id: 'c', kind: 'payment' as const, date: '2026-03-20', amount: -100_00, ref: 'LATE' },
  ];
  it('needs the same signed amount and a date within 7 days; a reference hit wins', () => {
    expect(suggestMatch({ date: '2026-03-03', description: '', reference: 'GTB-1', amount: -100_00 }, cands)?.id).toBe('a');
    expect(suggestMatch({ date: '2026-03-03', description: '', reference: '', amount: -100_00 }, cands)?.id).toBe('b'); // nearest date
    expect(suggestMatch({ date: '2026-03-03', description: '', reference: '', amount: 100_00 }, cands)).toBeNull(); // wrong sign
    expect(suggestMatch({ date: '2026-03-30', description: '', reference: '', amount: -100_00 }, cands)).toBeNull(); // too far
  });
});

describe('training validity', () => {
  it('adds months and clamps to month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-03-10', 24)).toBe('2028-03-10');
  });
});

describe('leave day counting with public holidays', () => {
  it('skips weekends and listed holidays', () => {
    expect(countDays('2026-03-02', '2026-03-06')).toBe(5); // Mon-Fri
    expect(countDays('2026-03-02', '2026-03-06', true, ['2026-03-04'])).toBe(4);
    expect(countDays('2026-03-07', '2026-03-08', true, [])).toBe(0);
    expect(countDays('2026-03-07', '2026-03-08', false, [])).toBe(2);
  });
});

describe('rotation patterns', () => {
  it('parses codes case-insensitively and treats OFF/X/- as days off', () => {
    expect(parsePattern('am, AM  off - pm', ['AM', 'PM'])).toEqual({ slots: ['AM', 'AM', null, null, 'PM'] });
    expect(parsePattern('AM ZZ', ['AM'])).toEqual({ error: expect.stringContaining('"ZZ" is not a shift code') });
    expect(parsePattern('AM', ['AM'])).toEqual({ error: expect.stringContaining('2 to 28') });
    expect(parsePattern('off off x', ['AM'])).toEqual({ error: expect.stringContaining('at least one working day') });
  });
  it('repeats the cycle from day 1 across the range', () => {
    const m = expandPattern(['N', 'N', null], '2026-03-02', '2026-03-10');
    expect(m.get('N')).toEqual(['2026-03-02', '2026-03-03', '2026-03-05', '2026-03-06', '2026-03-08', '2026-03-09']);
    expect(expandPattern(['A', 'B'], '2026-03-02', '2026-03-05').get('B')).toEqual(['2026-03-03', '2026-03-05']);
    expect(expandPattern([], '2026-03-02', '2026-03-05').size).toBe(0);
    expect(expandPattern(['A'], '2026-03-05', '2026-03-02').size).toBe(0);
  });
});
