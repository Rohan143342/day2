import { DEFAULT_ALLOCATION_ORDER, Dues, allocateRepayment } from '../allocation';
import { Money } from '../money';

const dues = (penalty: string, fees: string, interest: string, principal: string): Dues => ({
  PENALTY: Money.fromMajor(penalty),
  FEES: Money.fromMajor(fees),
  INTEREST: Money.fromMajor(interest),
  PRINCIPAL: Money.fromMajor(principal),
});

describe('allocateRepayment', () => {
  it('follows the configured order and stops when the money runs out', () => {
    const result = allocateRepayment(Money.fromMajor('2000.00'), dues('250.00', '100.00', '1500.00', '7668.00'));
    expect(result.allocated.PENALTY.toMajorString()).toBe('250.00');
    expect(result.allocated.FEES.toMajorString()).toBe('100.00');
    expect(result.allocated.INTEREST.toMajorString()).toBe('1500.00');
    expect(result.allocated.PRINCIPAL.toMajorString()).toBe('150.00');
    expect(result.unallocated.isZero()).toBe(true);
  });

  it('partially satisfies the first bucket it cannot cover', () => {
    const result = allocateRepayment(Money.fromMajor('100.00'), dues('250.00', '0.00', '1500.00', '7668.00'));
    expect(result.allocated.PENALTY.toMajorString()).toBe('100.00');
    expect(result.allocated.INTEREST.isZero()).toBe(true);
    expect(result.allocated.PRINCIPAL.isZero()).toBe(true);
  });

  it('surfaces an overpayment instead of absorbing it into principal', () => {
    const result = allocateRepayment(Money.fromMajor('10000.00'), dues('0.00', '0.00', '135.49', '9032.50'));
    expect(result.allocated.PRINCIPAL.toMajorString()).toBe('9032.50');
    expect(result.unallocated.toMajorString()).toBe('832.01');
  });

  it('honours a principal-first product configuration', () => {
    const result = allocateRepayment(Money.fromMajor('500.00'), dues('250.00', '0.00', '1500.00', '7668.00'), [
      'PRINCIPAL',
      'PENALTY',
      'FEES',
      'INTEREST',
    ]);
    expect(result.allocated.PRINCIPAL.toMajorString()).toBe('500.00');
    expect(result.allocated.PENALTY.isZero()).toBe(true);
  });

  it('allocates nothing for a zero receipt', () => {
    const result = allocateRepayment(Money.zero(), dues('250.00', '0.00', '1500.00', '7668.00'));
    expect(Object.values(result.allocated).every((m) => m.isZero())).toBe(true);
  });

  it('rejects an incomplete, duplicated, or negative input', () => {
    const d = dues('0.00', '0.00', '0.00', '100.00');
    expect(() => allocateRepayment(Money.fromMajor('-1.00'), d)).toThrow(RangeError);
    expect(() => allocateRepayment(Money.fromMajor('1.00'), d, ['PRINCIPAL', 'PRINCIPAL', 'FEES', 'INTEREST'])).toThrow(
      RangeError,
    );
    expect(() => allocateRepayment(Money.fromMajor('1.00'), d, ['PRINCIPAL', 'FEES', 'INTEREST'])).toThrow(RangeError);
    expect(() =>
      allocateRepayment(Money.fromMajor('1.00'), { ...d, PENALTY: Money.fromMajor('-5.00') }),
    ).toThrow(RangeError);
  });

  it('exposes the regulator-friendly default order', () => {
    expect([...DEFAULT_ALLOCATION_ORDER]).toEqual(['PENALTY', 'FEES', 'INTEREST', 'PRINCIPAL']);
  });
});
