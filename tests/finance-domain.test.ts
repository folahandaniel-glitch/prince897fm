import { describe, expect, it } from 'vitest';
import {
  accrualLines, budgetStatus, formatMoney, fromDb, isBalanced, MoneyError, naturalBalance, parseMoney, paymentLines, receiptLines, reverseLines,
  selectBand, sodViolation, toDb, transferLines,
} from '../src/domain/finance';

describe('money', () => {
  it('parses exactly, with no floating point drift', () => {
    expect(parseMoney('0.10') + parseMoney('0.20')).toBe(parseMoney('0.30'));
    expect(parseMoney('1,234.5')).toBe(123450);
    expect(parseMoney('₦25,000')).toBe(2_500_000);
  });
  it('rejects zero, negatives, too many decimals and junk', () => {
    for (const bad of ['0', '-5', '1.234', 'abc', '', '1e6', '99999999999999999']) expect(() => parseMoney(bad)).toThrow(MoneyError);
  });
  it('round-trips with database numeric text', () => {
    expect(fromDb('1234.50')).toBe(123450);
    expect(fromDb('-0.05')).toBe(-5);
    expect(toDb(123450)).toBe('1234.50');
    expect(toDb(-5)).toBe('-0.05');
  });
  it('formats naira', () => expect(formatMoney(250_000_00)).toMatch(/250,000\.00/));
});

describe('approval bands', () => {
  const bands = [{ minAmount: 0, steps: ['finance_manager'] }, { minAmount: 200_000_00, steps: ['finance_manager', 'ceo'] }, { minAmount: 2_000_000_00, steps: ['finance_manager', 'ceo', 'executive'] }];
  it('larger amounts need more approvers', () => {
    expect(selectBand(50_000_00, bands)!.steps).toEqual(['finance_manager']);
    expect(selectBand(200_000_00, bands)!.steps).toEqual(['finance_manager', 'ceo']);
    expect(selectBand(5_000_000_00, bands)!.steps).toHaveLength(3);
  });
  it('no bands means no automatic route', () => expect(selectBand(100, [])).toBeNull());
});

describe('separation of duties', () => {
  const t = { creator: 'c', reviewer: 'r', approvers: ['a1'], payer: 'p' };
  it('creator cannot review, approve or pay', () => {
    expect(sodViolation('c', 'review', t)).toBeTruthy();
    expect(sodViolation('c', 'approve', t)).toBeTruthy();
    expect(sodViolation('c', 'pay', t)).toBeTruthy();
  });
  it('reviewer cannot approve or pay; approver cannot pay or approve twice', () => {
    expect(sodViolation('r', 'approve', t)).toBeTruthy();
    expect(sodViolation('r', 'pay', t)).toBeTruthy();
    expect(sodViolation('a1', 'pay', t)).toBeTruthy();
    expect(sodViolation('a1', 'approve', t)).toBeTruthy();
  });
  it('payer cannot reconcile their own payment; independent people can act', () => {
    expect(sodViolation('p', 'reconcile', t)).toBeTruthy();
    expect(sodViolation('x', 'reconcile', t)).toBeNull();
    expect(sodViolation('x', 'approve', t)).toBeNull();
    expect(sodViolation('x', 'pay', t)).toBeNull();
  });
});

describe('ledger postings', () => {
  const amt = 123_456;
  it('every posting balances', () => {
    for (const l of [accrualLines({ categoryId: 'e', apId: 'ap', amount: amt }), paymentLines({ apId: 'ap', cashId: 'b', amount: amt }), receiptLines({ cashId: 'b', incomeId: 'i', amount: amt }), transferLines({ fromId: 'b', toId: 'c', amount: amt })]) expect(isBalanced(l)).toBe(true);
  });
  it('a reversal mirrors the original and nets to zero', () => {
    const orig = accrualLines({ categoryId: 'e', apId: 'ap', amount: amt });
    const rev = reverseLines(orig);
    expect(isBalanced(rev)).toBe(true);
    const net = [...orig, ...rev].reduce((m, l) => ({ ...m, [l.accountId]: (m[l.accountId] ?? 0) + l.debit - l.credit }), {} as Record<string, number>);
    expect(Object.values(net).every((v) => v === 0)).toBe(true);
  });
  it('detects unbalanced or malformed entries', () => {
    expect(isBalanced([{ accountId: 'a', debit: 100, credit: 0 }, { accountId: 'b', debit: 0, credit: 99 }])).toBe(false);
    expect(isBalanced([{ accountId: 'a', debit: 100, credit: 100 }, { accountId: 'b', debit: 0, credit: 0 }])).toBe(false);
    expect(isBalanced([])).toBe(false);
  });
  it('natural balances and budget levels', () => {
    expect(naturalBalance('asset', 500, 100)).toBe(400);
    expect(naturalBalance('income', 100, 500)).toBe(400);
    expect(budgetStatus(79, 100).level).toBe('ok');
    expect(budgetStatus(80, 100).level).toBe('warning');
    expect(budgetStatus(120, 100)).toEqual({ pct: 120, level: 'over' });
    expect(budgetStatus(5, 0).level).toBe('over');
  });
});
