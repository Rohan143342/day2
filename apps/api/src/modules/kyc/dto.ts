import { IsISO8601, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

/** Permanent Account Number: five letters, four digits, one letter. */
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export class VerifyPanDto {
  @Matches(PAN, { message: 'pan must be a valid 10-character PAN' })
  pan!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsISO8601({ strict: true }, { message: 'dateOfBirth must be an ISO date (YYYY-MM-DD)' })
  dateOfBirth!: string;
}

export class InitiateAadhaarDto {
  /** 12 digits. Stored encrypted, never returned, never logged. */
  @Matches(/^[0-9]{12}$/, { message: 'aadhaar must be 12 digits' })
  aadhaar!: string;
}

export class VerifyAadhaarOtpDto {
  @IsString()
  @Length(1, 128)
  verificationId!: string;

  @Matches(/^[0-9]{6}$/, { message: 'otp must be 6 digits' })
  otp!: string;
}
