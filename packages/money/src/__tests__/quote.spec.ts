import { Money } from '../money';
import { buildQuote } from '../quote';

const base = {
  principal: Money.fromMajor('100000.00'),
  annualRatePercent: 18,
  tenureMonths: 12,
  methodology: 'REDUCING_BALANCE' as const,
  firstDueDate: new Date(Date.UTC(2026, 0, 10)),
};

describe('buildQuote', () => {
  it('discloses every component of cost for a fee-deducted loan', () => {
    const quote = buildQuote({
      ...base,
      fees: {
        processingFeePercent: 2,
        taxOnFeesPercent: 18,
        feeCollection: 'DEDUCT_FROM_DISBURSEMENT',
      },
    });

    expect(quote.processingFee.toMajorString()).toBe('2000.00');
    expect(quote.taxOnFee.toMajorString()).toBe('360.00');
    expect(quote.netDisbursed.toMajorString()).toBe('97640.00');
    expect(quote.emi.toMajorString()).toBe('9168.00');
    expect(quote.totalInterest.toMajorString()).toBe('10015.99');
    expect(quote.totalCostOfCredit.toMajorString()).toBe('12375.99');
    expect(quote.totalPayable.toMajorString()).toBe('110015.99');
    expect(quote.apr.nominalAnnualPercent.toFixed(4)).toBe('22.6260');
  });

  it('does not reduce disbursement when fees are collected separately', () => {
    const quote = buildQuote({
      ...base,
      fees: {
        processingFeePercent: 2,
        taxOnFeesPercent: 18,
        feeCollection: 'COLLECTED_SEPARATELY',
      },
    });
    expect(quote.netDisbursed.toMajorString()).toBe('100000.00');
    expect(quote.totalPayable.toMajorString()).toBe('112375.99');
    expect(quote.totalCostOfCredit.toMajorString()).toBe('12375.99');
  });

  it('applies the configured fee floor and cap', () => {
    const floored = buildQuote({
      ...base,
      principal: Money.fromMajor('5000.00'),
      fees: {
        processingFeePercent: 2,
        processingFeeMin: Money.fromMajor('499.00'),
        taxOnFeesPercent: 18,
        feeCollection: 'DEDUCT_FROM_DISBURSEMENT',
      },
    });
    expect(floored.processingFee.toMajorString()).toBe('499.00');

    const capped = buildQuote({
      ...base,
      principal: Money.fromMajor('500000.00'),
      fees: {
        processingFeePercent: 2,
        processingFeeMax: Money.fromMajor('5000.00'),
        taxOnFeesPercent: 18,
        feeCollection: 'DEDUCT_FROM_DISBURSEMENT',
      },
    });
    expect(capped.processingFee.toMajorString()).toBe('5000.00');
  });

  it('never reports a zero-cost loan when a fee is charged, even at 0% interest', () => {
    const quote = buildQuote({
      ...base,
      annualRatePercent: 0,
      tenureMonths: 3,
      principal: Money.fromMajor('30000.00'),
      fees: {
        processingFeePercent: 3,
        taxOnFeesPercent: 18,
        feeCollection: 'DEDUCT_FROM_DISBURSEMENT',
      },
    });
    expect(quote.totalInterest.isZero()).toBe(true);
    expect(quote.totalCostOfCredit.isPositive()).toBe(true);
    expect(quote.apr.nominalAnnualPercent.greaterThan(0)).toBe(true);
  });

  it('keeps the schedule consistent with the headline figures', () => {
    const quote = buildQuote({
      ...base,
      fees: { processingFeePercent: 2, taxOnFeesPercent: 18, feeCollection: 'DEDUCT_FROM_DISBURSEMENT' },
    });
    const scheduleTotal = quote.schedule.installments.reduce((acc, i) => acc.add(i.totalDue), Money.zero());
    expect(scheduleTotal.equals(quote.schedule.totalPayable)).toBe(true);
    expect(quote.schedule.installments).toHaveLength(12);
  });
});
