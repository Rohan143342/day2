import { EmploymentType, IncomeVerificationMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Rupees with at most two decimal places; anything finer is not payable. */
const RUPEE_AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Fixed vocabulary. End-use is a regulated disclosure, so it must be selected
 * from a known list rather than typed as free text.
 */
export const LOAN_PURPOSE_CODES = [
  'MEDICAL',
  'EDUCATION',
  'HOME_IMPROVEMENT',
  'TRAVEL',
  'DEBT_CONSOLIDATION',
  'BUSINESS_WORKING_CAPITAL',
  'OTHER',
] as const;

export class CreateApplicationDto {
  @IsUUID()
  productVersionId!: string;

  @Matches(RUPEE_AMOUNT, { message: 'amount must be rupees with at most two decimal places' })
  amount!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  tenureMonths!: number;

  @IsIn(LOAN_PURPOSE_CODES)
  purposeCode!: (typeof LOAN_PURPOSE_CODES)[number];
}

export class SubmitProfileDto {
  @IsEnum(EmploymentType)
  employmentType!: EmploymentType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  employerName?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(720)
  workExperienceMonths!: number;

  @Matches(RUPEE_AMOUNT, { message: 'monthlyIncome must be rupees with at most two decimal places' })
  monthlyIncome!: string;

  @Matches(RUPEE_AMOUNT, {
    message: 'existingMonthlyEmi must be rupees with at most two decimal places',
  })
  existingMonthlyEmi!: string;

  /**
   * How the income was established. Clients may only declare; anything stronger
   * is set by the server once a provider has actually verified it.
   */
  @IsOptional()
  @IsIn([IncomeVerificationMethod.DECLARED])
  incomeVerification?: IncomeVerificationMethod;

  @IsString()
  @Length(2, 60)
  residenceState!: string;

  @Matches(/^\d{6}$/, { message: 'residencePincode must be six digits' })
  residencePincode!: string;

  @Matches(ISO_DATE, { message: 'dateOfBirth must be an ISO date (YYYY-MM-DD)' })
  dateOfBirth!: string;
}

export class WithdrawApplicationDto {
  @IsString()
  @Length(3, 280)
  reason!: string;
}
