import { Money, sumMoney } from '../money';

describe('Money', () => {
  it('parses major units exactly', () => {
    expect(Money.fromMajor('12500.50').minor).toBe(1250050n);
    expect(Money.fromMajor(0).minor).toBe(0n);
  });

  it('rejects sub-paisa precision instead of silently rounding', () => {
    expect(() => Money.fromMajor('10.005')).toThrow(RangeError);
  });

  it('rejects fractional minor units', () => {
    expect(() => Money.fromMinor(10.5)).toThrow(RangeError);
  });

  it('is immune to binary floating point error', () => {
    const tenPaise = Money.fromMajor('0.10');
    const total = sumMoney(Array.from({ length: 10 }, () => tenPaise));
    expect(total.toMajorString()).toBe('1.00');
    expect(total.equals(Money.fromMajor('1.00'))).toBe(true);
  });

  it('holds amounts far beyond the range of a float-safe integer', () => {
    const large = Money.fromMinor(9_007_199_254_740_993n); // 2^53 + 1 paise
    expect(large.add(Money.fromMinor(1n)).minor).toBe(9_007_199_254_740_994n);
  });

  it('rounds multiplication half-to-even at the paisa boundary', () => {
    // 0.125 rupees -> 12.5 paise -> 12 paise (half to even)
    expect(Money.fromMajor('0.25').multiply('0.5').minor).toBe(12n);
    // 0.375 rupees -> 37.5 paise -> 38 paise (half to even)
    expect(Money.fromMajor('0.75').multiply('0.5').minor).toBe(38n);
  });

  it('keeps subtraction signed rather than clamping at zero', () => {
    expect(Money.fromMajor('1').subtract(Money.fromMajor('3')).toMajorString()).toBe('-2.00');
  });
});
