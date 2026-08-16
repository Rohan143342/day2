import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, Matches, ValidateNested } from 'class-validator';

/** E.164 restricted to Indian mobile numbers for the first market. */
const INDIAN_MOBILE = /^\+91[6-9]\d{9}$/;

export class DeviceInfoDto {
  @IsString()
  @Length(8, 128)
  installationId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  model?: string;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  osVersion?: string;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  appVersion?: string;

  /**
   * Play Integrity verdict, treated as a fraud signal only. The server never
   * grants or denies access on the strength of a client-reported verdict.
   */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  integrityVerdict?: string;
}

export class SendOtpDto {
  @Matches(INDIAN_MOBILE, { message: 'phone must be a valid Indian mobile number in +91 format' })
  phone!: string;

  @IsIn(['REGISTRATION', 'LOGIN'])
  purpose!: 'REGISTRATION' | 'LOGIN';
}

export class VerifyOtpDto {
  @Matches(INDIAN_MOBILE, { message: 'phone must be a valid Indian mobile number in +91 format' })
  phone!: string;

  @IsString()
  @Length(6, 6)
  code!: string;

  @ValidateNested()
  @Type(() => DeviceInfoDto)
  device!: DeviceInfoDto;
}

export class RefreshDto {
  @IsString()
  @Length(16, 512)
  refreshToken!: string;
}
