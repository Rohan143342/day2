import Decimal from 'decimal.js';

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_EVEN });

export type Currency = 'INR';

/**
 * An exact monetary amount held in minor units (paise for INR).
 *
 * Floating point is never used to hold or move money. Rate arithmetic is done
 * in Decimal and only converted back to minor units at explicit rounding
 * boundaries, so every rounding decision in the system is a named call.
 */
export class Money {
  private constructor(
    readonly minor: bigint,
    readonly currency: Currency,
  ) {}

  static zero(currency: Currency = 'INR'): Money {
    return new Money(0n, currency);
  }

  static fromMinor(minor: bigint | number, currency: Currency = 'INR'): Money {
    if (typeof minor === 'number' && !Number.isInteger(minor)) {
      throw new RangeError(`minor units must be an integer, received ${minor}`);
    }
    return new Money(BigInt(minor), currency);
  }

  /** Parses a major-unit string such as "12500.50". Rejects excess precision. */
  static fromMajor(major: string | number, currency: Currency = 'INR'): Money {
    const value = new Decimal(major);
    const minor = value.mul(100);
    if (!minor.isInteger()) {
      throw new RangeError(`${major} has more precision than ${currency} supports`);
    }
    return new Money(BigInt(minor.toFixed(0)), currency);
  }

  /** Rounds a Decimal of major units to the nearest minor unit (banker's rounding). */
  static fromDecimalMajor(value: Decimal, currency: Currency = 'INR'): Money {
    return new Money(BigInt(value.mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).toFixed(0)), currency);
  }

  private assertSame(other: Money): void {
    if (other.currency !== this.currency) {
      throw new TypeError(`cannot combine ${this.currency} with ${other.currency}`);
    }
  }

  add(other: Money): Money {
    this.assertSame(other);
    return new Money(this.minor + other.minor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSame(other);
    return new Money(this.minor - other.minor, this.currency);
  }

  /** Multiplies by a dimensionless rate and rounds to the nearest minor unit. */
  multiply(rate: Decimal | string | number): Money {
    const product = this.toDecimalMajor().mul(new Decimal(rate));
    return Money.fromDecimalMajor(product, this.currency);
  }

  negate(): Money {
    return new Money(-this.minor, this.currency);
  }

  min(other: Money): Money {
    this.assertSame(other);
    return this.minor <= other.minor ? this : other;
  }

  max(other: Money): Money {
    this.assertSame(other);
    return this.minor >= other.minor ? this : other;
  }

  isZero(): boolean {
    return this.minor === 0n;
  }

  isNegative(): boolean {
    return this.minor < 0n;
  }

  isPositive(): boolean {
    return this.minor > 0n;
  }

  greaterThan(other: Money): boolean {
    this.assertSame(other);
    return this.minor > other.minor;
  }

  lessThan(other: Money): boolean {
    this.assertSame(other);
    return this.minor < other.minor;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minor === other.minor;
  }

  toDecimalMajor(): Decimal {
    return new Decimal(this.minor.toString()).div(100);
  }

  /** Exact major-unit string, always two decimals for INR. */
  toMajorString(): string {
    return this.toDecimalMajor().toFixed(2);
  }

  toJSON(): { minor: string; currency: Currency } {
    return { minor: this.minor.toString(), currency: this.currency };
  }
}

export const sumMoney = (amounts: Money[], currency: Currency = 'INR'): Money =>
  amounts.reduce((total, amount) => total.add(amount), Money.zero(currency));
