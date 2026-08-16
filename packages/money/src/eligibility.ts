import Decimal from 'decimal.js';
import { InterestMethodology, RepaymentFrequency, periodicRate } from './amortization';
import { Money } from './money';

/**
 * Inverse of the instalment formula: the largest principal whose instalment does
 * not exceed `maxInstallment`.
 *
 *   reducing balance: P = E * ((1 + i)^n - 1) / (i * (1 + i)^n)
 *   flat:             P = E * n / (1 + i * n)
 *
 * The result is rounded *down* to the paisa, so the derived instalment can never
 * come out above the affordability limit it was derived from.
 */
export const maxPrincipalForInstallment = (params: {
  maxInstallment: Money;
  annualRatePercent: Decimal | string | number;
  tenureMonths: number;
  methodology: InterestMethodology;
  frequency?: RepaymentFrequency;
}): Money => {
  const { maxInstallment, tenureMonths, methodology } = params;
  if (!Number.isInteger(tenureMonths) || tenureMonths <= 0) {
    throw new RangeError(`tenure must be a positive whole number of periods, received ${tenureMonths}`);
  }
  if (maxInstallment.isNegative()) {
    throw new RangeError('maximum instalment must not be negative');
  }
  const rate = periodicRate(params.annualRatePercent, params.frequency ?? 'MONTHLY');
  if (rate.isNegative()) throw new RangeError('interest rate must not be negative');

  const e = maxInstallment.toDecimalMajor();
  let principal: Decimal;
  if (rate.isZero()) {
    principal = e.mul(tenureMonths);
  } else if (methodology === 'REDUCING_BALANCE') {
    const growth = rate.plus(1).pow(tenureMonths);
    principal = e.mul(growth.minus(1)).div(rate.mul(growth));
  } else {
    principal = e.mul(tenureMonths).div(rate.mul(tenureMonths).plus(1));
  }

  return Money.fromDecimalMajor(
    principal.toDecimalPlaces(2, Decimal.ROUND_DOWN),
    maxInstallment.currency,
  );
};

/**
 * Fixed-obligation-to-income ratio: the share of monthly income already
 * committed to debt, plus the instalment being considered.
 */
export const foir = (params: {
  monthlyIncome: Money;
  existingObligations: Money;
  proposedInstallment: Money;
}): Decimal => {
  const income = params.monthlyIncome.toDecimalMajor();
  if (income.lessThanOrEqualTo(0)) throw new RangeError('monthly income must be positive');
  return params.existingObligations
    .add(params.proposedInstallment)
    .toDecimalMajor()
    .div(income);
};

/** Monthly instalment capacity left after existing obligations, floored at zero. */
export const affordableInstallment = (params: {
  monthlyIncome: Money;
  existingObligations: Money;
  maxFoir: Decimal | string | number;
}): Money => {
  const capacity = Money.fromDecimalMajor(
    params.monthlyIncome.toDecimalMajor().mul(new Decimal(params.maxFoir)),
    params.monthlyIncome.currency,
  ).subtract(params.existingObligations);
  return capacity.isNegative() ? Money.zero(params.monthlyIncome.currency) : capacity;
};
