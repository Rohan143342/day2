import { Money, sumMoney } from './money';

export type DueBucket = 'PENALTY' | 'FEES' | 'INTEREST' | 'PRINCIPAL';

export const DEFAULT_ALLOCATION_ORDER: readonly DueBucket[] = [
  'PENALTY',
  'FEES',
  'INTEREST',
  'PRINCIPAL',
];

export type Dues = Record<DueBucket, Money>;

export interface AllocationResult {
  allocated: Dues;
  /** Amount left after every bucket is satisfied — an overpayment. */
  unallocated: Money;
}

/**
 * Splits a received amount across outstanding dues in the order the loan
 * product version prescribes. The order is data, not a code branch, so a
 * product can change allocation without a deploy and historical loans keep
 * the order they were originated under.
 */
export const allocateRepayment = (
  received: Money,
  dues: Dues,
  order: readonly DueBucket[] = DEFAULT_ALLOCATION_ORDER,
): AllocationResult => {
  if (received.isNegative()) {
    throw new RangeError('received amount must not be negative');
  }
  if (order.length !== new Set(order).size) {
    throw new RangeError('allocation order must not repeat a bucket');
  }
  for (const bucket of DEFAULT_ALLOCATION_ORDER) {
    if (!order.includes(bucket)) {
      throw new RangeError(`allocation order is missing the ${bucket} bucket`);
    }
    if (dues[bucket].isNegative()) {
      throw new RangeError(`${bucket} due must not be negative`);
    }
  }

  const currency = received.currency;
  let remaining = received;
  const allocated: Dues = {
    PENALTY: Money.zero(currency),
    FEES: Money.zero(currency),
    INTEREST: Money.zero(currency),
    PRINCIPAL: Money.zero(currency),
  };

  for (const bucket of order) {
    if (!remaining.isPositive()) break;
    const applied = remaining.min(dues[bucket]);
    allocated[bucket] = applied;
    remaining = remaining.subtract(applied);
  }

  const total = sumMoney(Object.values(allocated), currency);
  if (!total.add(remaining).equals(received)) {
    throw new Error('allocation invariant violated: allocated + unallocated != received');
  }

  return { allocated, unallocated: remaining };
};
