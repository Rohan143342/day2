import Decimal from 'decimal.js';
import { Money } from './money';

export interface AprRequest {
  /** Sanctioned principal, before any deduction. */
  principal: Money;
  /** Everything the borrower is charged up front and does not receive in hand. */
  upfrontDeductions: Money;
  /** Actual instalments the borrower will pay, in order. */
  installments: Money[];
  periodsPerYear?: number;
}

export interface AprResult {
  /** Periodic internal rate of return as a fraction. */
  periodicRate: Decimal;
  /** Periodic rate annualised by simple multiplication. */
  nominalAnnualPercent: Decimal;
  /** Periodic rate compounded over a year. */
  effectiveAnnualPercent: Decimal;
  netDisbursed: Money;
  totalPayable: Money;
}

const npv = (rate: Decimal, netDisbursed: Decimal, installments: Decimal[]): Decimal =>
  installments.reduce(
    (acc, amount, index) => acc.plus(amount.div(rate.plus(1).pow(index + 1))),
    new Decimal(0),
  ).minus(netDisbursed);

/**
 * Annual percentage rate: the periodic rate at which the present value of the
 * borrower's instalments equals what the borrower actually received. Upfront
 * fees therefore raise the APR above the nominal interest rate, which is the
 * entire point of disclosing it.
 *
 * Solved by bisection rather than Newton's method: slower, but it cannot
 * diverge, and a lending disclosure must never fail to converge.
 */
export const calculateApr = (request: AprRequest): AprResult => {
  const periodsPerYear = request.periodsPerYear ?? 12;
  const netDisbursed = request.principal.subtract(request.upfrontDeductions);
  if (!netDisbursed.isPositive()) {
    throw new RangeError('upfront deductions must not equal or exceed the principal');
  }
  if (request.installments.length === 0) {
    throw new RangeError('at least one instalment is required');
  }

  const target = netDisbursed.toDecimalMajor();
  const flows = request.installments.map((i) => i.toDecimalMajor());
  const totalPayable = request.installments.reduce(
    (acc, i) => acc.add(i),
    Money.zero(request.principal.currency),
  );

  if (npv(new Decimal(0), target, flows).isNegative()) {
    throw new RangeError('instalments do not repay the disbursed amount; APR is undefined');
  }

  let low = new Decimal(0);
  let high = new Decimal(1); // 100% per period; ample headroom for any lawful product
  while (npv(high, target, flows).isPositive()) {
    high = high.mul(2);
    if (high.greaterThan(1000)) {
      throw new RangeError('APR did not bracket; instalment schedule looks implausible');
    }
  }

  for (let iteration = 0; iteration < 200; iteration += 1) {
    const mid = low.plus(high).div(2);
    if (npv(mid, target, flows).isPositive()) {
      low = mid;
    } else {
      high = mid;
    }
  }
  const periodicRate = low.plus(high).div(2);

  return {
    periodicRate,
    nominalAnnualPercent: periodicRate.mul(periodsPerYear).mul(100).toDecimalPlaces(4),
    effectiveAnnualPercent: periodicRate.plus(1).pow(periodsPerYear).minus(1).mul(100).toDecimalPlaces(4),
    netDisbursed,
    totalPayable,
  };
};
