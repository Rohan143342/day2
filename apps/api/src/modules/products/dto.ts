import { Type } from 'class-transformer';
import { IsInt, IsUUID, Matches, Max, Min } from 'class-validator';

/** Rupees with at most two decimal places; anything finer is not payable. */
const RUPEE_AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;

export class QuoteRequestDto {
  @IsUUID()
  productVersionId!: string;

  /**
   * Rupees as a decimal string. A number would be a float, and a float has no
   * place anywhere near a loan amount.
   */
  @Matches(RUPEE_AMOUNT, { message: 'amount must be rupees with at most two decimal places' })
  amount!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  tenureMonths!: number;
}
