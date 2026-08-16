import { buildSchedule, equatedInstallment } from '../amortization';
import { Money } from '../money';

const firstDueDate = new Date(Date.UTC(2026, 0, 10));

describe('equatedInstallment', () => {
  // Reference values computed independently (exact decimal arithmetic, half-even
  // rounding to the paisa) rather than taken from this implementation.
  it.each([
    ['100000.00', 12, 12, '8884.88'],
    ['50000.00', 18, 6, '8776.26'],
    ['250000.00', '15.5', 24, '12181.14'],
    ['30000.00', 0, 3, '10000.00'],
  ])('P=%s rate=%s%% n=%i -> EMI %s', (principal, rate, tenure, expected) => {
    expect(equatedInstallment(Money.fromMajor(principal as string), rate, tenure as number).toMajorString()).toBe(
      expected,
    );
  });

  it('rejects a non-integral or non-positive tenure', () => {
    expect(() => equatedInstallment(Money.fromMajor('1000'), 12, 0)).toThrow(RangeError);
    expect(() => equatedInstallment(Money.fromMajor('1000'), 12, 1.5)).toThrow(RangeError);
  });

  it('rejects a negative rate', () => {
    expect(() => equatedInstallment(Money.fromMajor('1000'), -1, 6)).toThrow(RangeError);
  });
});

describe('buildSchedule (reducing balance)', () => {
  const schedule = buildSchedule({
    principal: Money.fromMajor('100000.00'),
    annualRatePercent: 18,
    tenureMonths: 12,
    methodology: 'REDUCING_BALANCE',
    firstDueDate,
  });

  it('matches the reference amortisation row by row', () => {
    expect(schedule.emi.toMajorString()).toBe('9168.00');
    expect(schedule.installments[0].interestDue.toMajorString()).toBe('1500.00');
    expect(schedule.installments[0].principalDue.toMajorString()).toBe('7668.00');
    expect(schedule.installments[0].closingPrincipal.toMajorString()).toBe('92332.00');
    expect(schedule.installments[1].interestDue.toMajorString()).toBe('1384.98');
    expect(schedule.installments[10].interestDue.toMajorString()).toBe('268.97');
    expect(schedule.installments[11].principalDue.toMajorString()).toBe('9032.50');
    expect(schedule.totalInterest.toMajorString()).toBe('10015.99');
    expect(schedule.totalPayable.toMajorString()).toBe('110015.99');
  });

  it('closes out to exactly zero principal', () => {
    const last = schedule.installments[schedule.installments.length - 1];
    expect(last.closingPrincipal.isZero()).toBe(true);
    expect(schedule.totalPrincipal.toMajorString()).toBe('100000.00');
  });

  it('walks due dates by calendar month and clamps to short months', () => {
    const endOfMonth = buildSchedule({
      principal: Money.fromMajor('60000.00'),
      annualRatePercent: 12,
      tenureMonths: 4,
      methodology: 'REDUCING_BALANCE',
      firstDueDate: new Date(Date.UTC(2026, 0, 31)),
    });
    const dates = endOfMonth.installments.map((i) => i.dueDate.toISOString().slice(0, 10));
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('never leaves a rounding residue regardless of tenure', () => {
    for (const tenure of [3, 7, 11, 18, 24, 36, 60]) {
      const s = buildSchedule({
        principal: Money.fromMajor('87345.37'),
        annualRatePercent: '16.75',
        tenureMonths: tenure,
        methodology: 'REDUCING_BALANCE',
        firstDueDate,
      });
      expect(s.totalPrincipal.toMajorString()).toBe('87345.37');
      expect(s.installments[tenure - 1].closingPrincipal.isZero()).toBe(true);
    }
  });
});

describe('buildSchedule (flat)', () => {
  it('charges interest on the original principal every period', () => {
    const schedule = buildSchedule({
      principal: Money.fromMajor('120000.00'),
      annualRatePercent: 12,
      tenureMonths: 12,
      methodology: 'FLAT',
      firstDueDate,
    });
    // 1% of the original principal every month, for all twelve months.
    expect(schedule.installments.every((i) => i.interestDue.toMajorString() === '1200.00')).toBe(true);
    expect(schedule.totalInterest.toMajorString()).toBe('14400.00');
    expect(schedule.totalPrincipal.toMajorString()).toBe('120000.00');
  });

  it('is more expensive than reducing balance at the same nominal rate', () => {
    const shared = {
      principal: Money.fromMajor('120000.00'),
      annualRatePercent: 12,
      tenureMonths: 12,
      firstDueDate,
    } as const;
    const flat = buildSchedule({ ...shared, methodology: 'FLAT' });
    const reducing = buildSchedule({ ...shared, methodology: 'REDUCING_BALANCE' });
    expect(flat.totalInterest.greaterThan(reducing.totalInterest)).toBe(true);
  });
});
