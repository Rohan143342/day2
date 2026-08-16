import Decimal from 'decimal.js';
import { AmortizationSchedule, InterestMethodology, RepaymentFrequency, buildSchedule } from './amortization';
import { AprResult, calculateApr } from './apr';
import { Money } from './money';

export interface FeeConfig {
  /** Percentage of principal, e.g. "2" for 2%. */
  processingFeePercent: Decimal | string | number;
  /** Floor and cap applied to the computed processing fee. */
  processingFeeMin?: Money;
  processingFeeMax?: Money;
  /** Tax on fees as a percentage, e.g. GST. Rate is configuration, never a constant. */
  taxOnFeesPercent: Decimal | string | number;
  /** Whether fees are deducted from disbursement or collected separately. */
  feeCollection: 'DEDUCT_FROM_DISBURSEMENT' | 'COLLECTED_SEPARATELY';
}

export interface QuoteRequest {
  principal: Money;
  annualRatePercent: Decimal | string | number;
  tenureMonths: number;
  methodology: InterestMethodology;
  frequency?: RepaymentFrequency;
  firstDueDate: Date;
  fees: FeeConfig;
}

export interface Quote {
  principal: Money;
  processingFee: Money;
  taxOnFee: Money;
  netDisbursed: Money;
  emi: Money;
  totalInterest: Money;
  /** Principal + interest + fees + taxes: the single number a borrower must see. */
  totalCostOfCredit: Money;
  totalPayable: Money;
  apr: AprResult;
  schedule: AmortizationSchedule;
}

const clamp = (value: Money, min?: Money, max?: Money): Money => {
  let result = value;
  if (min) result = result.max(min);
  if (max) result = result.min(max);
  return result;
};

/**
 * The single authoritative pricing computation. Clients render this; they never
 * derive any of it. Every borrower-facing disclosure (Key Fact Statement,
 * offer screen, agreement) is generated from one Quote instance so the numbers
 * cannot disagree between surfaces.
 */
export const buildQuote = (request: QuoteRequest): Quote => {
  const schedule = buildSchedule({
    principal: request.principal,
    annualRatePercent: request.annualRatePercent,
    tenureMonths: request.tenureMonths,
    methodology: request.methodology,
    frequency: request.frequency,
    firstDueDate: request.firstDueDate,
  });

  const rawFee = request.principal.multiply(new Decimal(request.fees.processingFeePercent).div(100));
  const processingFee = clamp(rawFee, request.fees.processingFeeMin, request.fees.processingFeeMax);
  const taxOnFee = processingFee.multiply(new Decimal(request.fees.taxOnFeesPercent).div(100));
  const upfrontCharges = processingFee.add(taxOnFee);

  const deductedUpfront =
    request.fees.feeCollection === 'DEDUCT_FROM_DISBURSEMENT' ? upfrontCharges : Money.zero(request.principal.currency);

  const apr = calculateApr({
    principal: request.principal,
    upfrontDeductions: deductedUpfront,
    installments: schedule.installments.map((i) => i.totalDue),
  });

  return {
    principal: request.principal,
    processingFee,
    taxOnFee,
    netDisbursed: request.principal.subtract(deductedUpfront),
    emi: schedule.emi,
    totalInterest: schedule.totalInterest,
    totalCostOfCredit: schedule.totalInterest.add(upfrontCharges),
    totalPayable: schedule.totalPayable.add(
      request.fees.feeCollection === 'COLLECTED_SEPARATELY' ? upfrontCharges : Money.zero(request.principal.currency),
    ),
    apr,
    schedule,
  };
};
