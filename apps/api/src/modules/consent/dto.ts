import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsBoolean, IsInt, IsString, Length, Min, ValidateNested } from 'class-validator';

export class ConsentDecisionDto {
  @IsString()
  @Length(1, 64)
  purposeCode!: string;

  @IsInt()
  @Min(1)
  textVersion!: number;

  /**
   * Explicit per-purpose decision. There is no "accept all" shortcut: bundling
   * optional consent with required consent is a dark pattern.
   */
  @IsBoolean()
  granted!: boolean;
}

export class RecordConsentsDto {
  @ValidateNested({ each: true })
  @Type(() => ConsentDecisionDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  decisions!: ConsentDecisionDto[];
}

export class WithdrawConsentDto {
  @IsString()
  @Length(1, 64)
  purposeCode!: string;

  @IsString()
  @Length(1, 500)
  reason!: string;
}
