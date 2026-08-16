import Decimal from 'decimal.js';
import { Money } from './money';

export type InterestMethodology = 'REDUCING_BALANCE' | 'FLAT';
export type RepaymentFrequency = 'MONTHLY';

export interface AmortizationRequest {
  principal: Money;
  /** Nominal annual interest rate in percent, e.g. "18.5". */
  annualRatePercent: Decimal | string | number;
  tenureMonths: number;
  methodology: InterestMethodology;
  frequency?: RepaymentFrequency;
  firstDueDate: Date;
}

export interface Installment {
  installmentNumber: number;
  dueDate: Date;
  openingPrincipal: Money;
  principalDue: Money;
  interestDue: Money;
  totalDue: Money;
  closingPrincipal: Money;
}

export interface AmortizationSchedule {
  installments: Installment[];
  emi: Money;
  totalPrincipal: Money;
  totalInterest: Money;
  totalPayable: Money;
}

const periodsPerYear = (frequency: RepaymentFrequency): number => {
  switch (frequency) {
    case 'MONTHLY':
      return 12;
    default: {
      const exhaustive: never = frequency;
      throw new RangeError(`unsupported repayment frequency ${String(exhaustive)}`);
    }
  }
};

const addMonths = (date: Date, months: number): Date => {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(date.getUTCDate(), lastDayOfTargetMonth));
  return result;
};

/** Periodic rate as a fraction, e.g. 18% annual monthly -> 0.015. */
export const periodicRate = (
  annualRatePercent: Decimal | string | number,
  frequency: RepaymentFrequency = 'MONTHLY',
): Decimal => new Decimal(annualRatePercent).div(100).div(periodsPerYear(frequency));

/**
 * Equated instalment for a reducing-balance loan:
 *   E = P * i * (1 + i)^n / ((1 + i)^n - 1)
 * With a zero rate this degenerates to P / n.
 */
export const equatedInstallment = (
  principal: Money,
  annualRatePercent: Decimal | string | number,
  tenureMonths: number,
  frequency: RepaymentFrequency = 'MONTHLY',
): Money => {
  if (!Number.isInteger(tenureMonths) || tenureMonths <= 0) {
    throw new RangeError(`tenure must be a positive whole number of periods, received ${tenureMonths}`);
  }
  const rate = periodicRate(annualRatePercent, frequency);
  if (rate.isNegative()) {
    throw new RangeError('interest rate must not be negative');
  }
  const p = principal.toDecimalMajor();
  if (rate.isZero()) {
    return Money.fromDecimalMajor(p.div(tenureMonths), principal.currency);
  }
  const growth = rate.plus(1).pow(tenureMonths);
  return Money.fromDecimalMajor(p.mul(rate).mul(growth).div(growth.minus(1)), principal.currency);
};

/**
 * Builds the repayment schedule. Rounding residue is absorbed by the final
 * instalment so that the sum of principal instalments equals the principal
 * exactly — the schedule can never over- or under-collect by a paisa.
 */
export const buildSchedule = (request: AmortizationRequest): AmortizationSchedule => {
  const frequency = request.frequency ?? 'MONTHLY';
  const { principal, tenureMonths, methodology } = request;
  if (!principal.isPositive()) {
    throw new RangeError('principal must be positive');
  }
  const rate = periodicRate(request.annualRatePercent, frequency);

  const emi =
    methodology === 'REDUCING_BALANCE'
      ? equatedInstallment(principal, request.annualRatePercent, tenureMonths, frequency)
      : flatInstallment(principal, rate, tenureMonths);

  const installments: Installment[] = [];
  let outstanding = principal;

  for (let n = 1; n <= tenureMonths; n += 1) {
    const isFinal = n === tenureMonths;
    const openingPrincipal = outstanding;

    let interestDue: Money;
    let principalDue: Money;

    if (methodology === 'REDUCING_BALANCE') {
      interestDue = openingPrincipal.multiply(rate);
      principalDue = isFinal ? openingPrincipal : emi.subtract(interestDue);
    } else {
      const flatInterestPerPeriod = principal.multiply(rate);
      interestDue = flatInterestPerPeriod;
      principalDue = isFinal ? openingPrincipal : emi.subtract(flatInterestPerPeriod);
    }

    if (!isFinal && principalDue.isNegative()) {
      throw new RangeError('instalment does not cover periodic interest; tenure or rate is invalid');
    }

    const closingPrincipal = openingPrincipal.subtract(principalDue);
    installments.push({
      installmentNumber: n,
      dueDate: addMonths(request.firstDueDate, n - 1),
      openingPrincipal,
      principalDue,
      interestDue,
      totalDue: principalDue.add(interestDue),
      closingPrincipal,
    });
    outstanding = closingPrincipal;
  }

  const totalInterest = installments.reduce((acc, i) => acc.add(i.interestDue), Money.zero(principal.currency));
  const totalPrincipal = installments.reduce((acc, i) => acc.add(i.principalDue), Money.zero(principal.currency));

  return {
    installments,
    emi,
    totalPrincipal,
    totalInterest,
    totalPayable: totalPrincipal.add(totalInterest),
  };
};

const flatInstallment = (principal: Money, rate: Decimal, tenureMonths: number): Money => {
  const totalInterest = principal.multiply(rate.mul(tenureMonths));
  return Money.fromDecimalMajor(
    principal.add(totalInterest).toDecimalMajor().div(tenureMonths),
    principal.currency,
  );
};

export const __testing = { addMonths };
