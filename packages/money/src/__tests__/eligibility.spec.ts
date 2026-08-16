import Decimal from 'decimal.js';
import { equatedInstallment } from '../amortization';
import { affordableInstallment, foir, maxPrincipalForInstallment } from '../eligibility';
import { Money } from '../money';

describe('maxPrincipalForInstallment', () => {
  it('inverts the instalment formula without exceeding the affordability limit', () => {
    const maxInstallment = Money.fromMajor('9168');
    const principal = maxPrincipalForInstallment({
      maxInstallment,
      annualRatePercent: '18',
      tenureMonths: 12,
      methodology: 'REDUCING_BALANCE',
    });

    // Round-tripping must never produce an instalment above the cap.
    const derived = equatedInstallment(principal, '18', 12);
    expect(derived.minor).toBeLessThanOrEqual(maxInstallment.minor);
    // ...and must be within a paisa of it, i.e. no capacity is thrown away.
    expect(maxInstallment.subtract(derived).minor).toBeLessThanOrEqual(1n);
  });

  it('holds for a flat-rate product', () => {
    const maxInstallment = Money.fromMajor('5000');
    const principal = maxPrincipalForInstallment({
      maxInstallment,
      annualRatePercent: '12',
      tenureMonths: 24,
      methodology: 'FLAT',
    });
    const totalInterest = principal.multiply(new Decimal('0.01').mul(24));
    const derived = Money.fromDecimalMajor(
      principal.add(totalInterest).toDecimalMajor().div(24),
    );
    expect(derived.minor).toBeLessThanOrEqual(maxInstallment.minor);
  });

  it('degenerates to instalment times tenure at a zero rate', () => {
    expect(
      maxPrincipalForInstallment({
        maxInstallment: Money.fromMajor('1000'),
        annualRatePercent: 0,
        tenureMonths: 10,
        methodology: 'REDUCING_BALANCE',
      }).toMajorString(),
    ).toBe('10000.00');
  });

  it('returns zero principal for zero capacity', () => {
    expect(
      maxPrincipalForInstallment({
        maxInstallment: Money.zero(),
        annualRatePercent: '18',
        tenureMonths: 12,
        methodology: 'REDUCING_BALANCE',
      }).isZero(),
    ).toBe(true);
  });

  it('rejects an invalid tenure or a negative instalment', () => {
    expect(() =>
      maxPrincipalForInstallment({
        maxInstallment: Money.fromMajor('1000'),
        annualRatePercent: '18',
        tenureMonths: 0,
        methodology: 'REDUCING_BALANCE',
      }),
    ).toThrow(RangeError);
    expect(() =>
      maxPrincipalForInstallment({
        maxInstallment: Money.fromMinor(-1n),
        annualRatePercent: '18',
        tenureMonths: 12,
        methodology: 'REDUCING_BALANCE',
      }),
    ).toThrow(RangeError);
  });
});

describe('foir', () => {
  it('counts existing obligations and the proposed instalment against income', () => {
    const ratio = foir({
      monthlyIncome: Money.fromMajor('50000'),
      existingObligations: Money.fromMajor('5000'),
      proposedInstallment: Money.fromMajor('10000'),
    });
    expect(ratio.toFixed(4)).toBe('0.3000');
  });

  it('refuses a non-positive income rather than dividing by zero', () => {
    expect(() =>
      foir({
        monthlyIncome: Money.zero(),
        existingObligations: Money.zero(),
        proposedInstallment: Money.fromMajor('1'),
      }),
    ).toThrow(RangeError);
  });
});

describe('affordableInstallment', () => {
  it('is the FOIR budget less existing obligations', () => {
    expect(
      affordableInstallment({
        monthlyIncome: Money.fromMajor('50000'),
        existingObligations: Money.fromMajor('5000'),
        maxFoir: '0.5',
      }).toMajorString(),
    ).toBe('20000.00');
  });

  it('floors at zero when obligations already exceed the budget', () => {
    expect(
      affordableInstallment({
        monthlyIncome: Money.fromMajor('20000'),
        existingObligations: Money.fromMajor('15000'),
        maxFoir: '0.5',
      }).isZero(),
    ).toBe(true);
  });
});
