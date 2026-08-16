import { buildSchedule } from '../amortization';
import { calculateApr } from '../apr';
import { Money } from '../money';

const firstDueDate = new Date(Date.UTC(2026, 0, 10));

describe('calculateApr', () => {
  it('equals the nominal rate when there are no fees', () => {
    const schedule = buildSchedule({
      principal: Money.fromMajor('100000.00'),
      annualRatePercent: 18,
      tenureMonths: 12,
      methodology: 'REDUCING_BALANCE',
      firstDueDate,
    });
    const apr = calculateApr({
      principal: Money.fromMajor('100000.00'),
      upfrontDeductions: Money.zero(),
      installments: schedule.installments.map((i) => i.totalDue),
    });
    // Within a basis point of 18% — residual difference is instalment rounding.
    expect(Number(apr.nominalAnnualPercent)).toBeCloseTo(18, 2);
  });

  it('rises above the nominal rate once upfront fees are deducted', () => {
    // 18% nominal, 2% processing fee, 18% tax on the fee, all deducted at disbursement.
    // Reference: periodic 0.018855…, nominal 22.6260%, effective 25.1263%.
    const schedule = buildSchedule({
      principal: Money.fromMajor('100000.00'),
      annualRatePercent: 18,
      tenureMonths: 12,
      methodology: 'REDUCING_BALANCE',
      firstDueDate,
    });
    const apr = calculateApr({
      principal: Money.fromMajor('100000.00'),
      upfrontDeductions: Money.fromMajor('2360.00'),
      installments: schedule.installments.map((i) => i.totalDue),
    });
    expect(apr.netDisbursed.toMajorString()).toBe('97640.00');
    expect(apr.nominalAnnualPercent.toFixed(4)).toBe('22.6260');
    expect(apr.effectiveAnnualPercent.toFixed(4)).toBe('25.1263');
    expect(apr.totalPayable.toMajorString()).toBe('110015.99');
  });

  it('reports a zero rate for an interest-free, fee-free loan', () => {
    const apr = calculateApr({
      principal: Money.fromMajor('30000.00'),
      upfrontDeductions: Money.zero(),
      installments: [Money.fromMajor('10000.00'), Money.fromMajor('10000.00'), Money.fromMajor('10000.00')],
    });
    expect(Number(apr.nominalAnnualPercent)).toBeCloseTo(0, 6);
  });

  it('refuses to describe a schedule that does not repay the disbursed amount', () => {
    expect(() =>
      calculateApr({
        principal: Money.fromMajor('10000.00'),
        upfrontDeductions: Money.zero(),
        installments: [Money.fromMajor('1000.00')],
      }),
    ).toThrow(RangeError);
  });

  it('refuses to treat fees that swallow the whole principal as a loan', () => {
    expect(() =>
      calculateApr({
        principal: Money.fromMajor('1000.00'),
        upfrontDeductions: Money.fromMajor('1000.00'),
        installments: [Money.fromMajor('100.00')],
      }),
    ).toThrow(RangeError);
  });
});
