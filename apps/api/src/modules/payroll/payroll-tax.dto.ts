import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PROOF_HEADS, TAX_REGIMES, type ProofHead, type TaxRegime } from '@hsdg/contracts';
import { VersionDto } from './payroll.dto';

const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const RATE = /^\d{1,2}(\.\d{1,2})?$/;
const amount = { message: 'must be an amount with up to two decimals.' };

export class TaxYearParamDto {
  @ApiProperty({ example: 2026, description: 'The year the tax year starts in (2026 = 2026-27).' })
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  year!: number;
}

export class TaxYearEmployeeParamDto extends TaxYearParamDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;
}

export class QuarterParamDto extends TaxYearParamDto {
  @ApiProperty({ enum: [1, 2, 3, 4] })
  @Type(() => Number)
  @IsIn([1, 2, 3, 4])
  quarter!: 1 | 2 | 3 | 4;
}

export class MonthQueryDto {
  @ApiPropertyOptional({ example: '2026-10' })
  @IsOptional()
  @Matches(MONTH, { message: 'month must be YYYY-MM.' })
  month?: string;
}

export class DeclarationAmountsDto {
  @ApiProperty() @Matches(AMOUNT, amount) rentMonthly!: string;
  @ApiProperty() @IsBoolean() metroCity!: boolean;
  @ApiProperty() @IsBoolean() landlordPanGiven!: boolean;
  @ApiProperty() @Matches(AMOUNT, amount) lta!: string;
  @ApiProperty() @Matches(AMOUNT, amount) section80C!: string;
  @ApiProperty() @Matches(AMOUNT, amount) section80CCD1B!: string;
  @ApiProperty() @Matches(AMOUNT, amount) section80DSelf!: string;
  @ApiProperty() @IsBoolean() selfSenior!: boolean;
  @ApiProperty() @Matches(AMOUNT, amount) section80DParents!: string;
  @ApiProperty() @IsBoolean() parentsSenior!: boolean;
  @ApiProperty() @Matches(AMOUNT, amount) homeLoanInterest!: string;
  @ApiProperty() @Matches(AMOUNT, amount) section80E!: string;
  @ApiProperty() @Matches(AMOUNT, amount) section80G!: string;
  @ApiProperty() @Matches(AMOUNT, amount) section80TTA!: string;
  @ApiProperty() @Matches(AMOUNT, amount) otherIncome!: string;
}

export class PreviousEmploymentDto {
  @ApiProperty() @Matches(AMOUNT, amount) income!: string;
  @ApiProperty() @Matches(AMOUNT, amount) tds!: string;
  @ApiProperty() @Matches(AMOUNT, amount) pf!: string;
  @ApiProperty() @Matches(AMOUNT, amount) pt!: string;
}

export class SaveDeclarationDto {
  @ApiProperty({ description: 'The version read (0 for a declaration not yet saved).' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version!: number;

  @ApiProperty({ enum: TAX_REGIMES })
  @IsIn(TAX_REGIMES)
  regime!: TaxRegime;

  @ApiProperty({ type: DeclarationAmountsDto })
  @ValidateNested()
  @Type(() => DeclarationAmountsDto)
  amounts!: DeclarationAmountsDto;

  @ApiPropertyOptional({ type: PreviousEmploymentDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => PreviousEmploymentDto)
  previousEmployment?: PreviousEmploymentDto | null;
}

export class LockDeclarationDto extends VersionDto {
  @ApiProperty({ description: 'true locks, false unlocks.' })
  @IsBoolean()
  locked!: boolean;
}

export class SubmitProofDto {
  @ApiProperty({ enum: PROOF_HEADS })
  @IsIn(PROOF_HEADS)
  head!: ProofHead;

  @ApiProperty({ example: '150000.00' })
  @Matches(AMOUNT, amount)
  amount!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 400)
  filename!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  contentType?: string;

  @ApiProperty({ description: 'The file, base64.' })
  @IsString()
  contentBase64!: string;
}

export class DecideProofDto {
  @ApiProperty({ enum: ['accept', 'reject'] })
  @IsIn(['accept', 'reject'])
  decision!: 'accept' | 'reject';

  @ApiPropertyOptional({ description: 'Accept in part (default: the amount claimed).' })
  @IsOptional()
  @Matches(AMOUNT, amount)
  acceptedAmount?: string;

  @ApiPropertyOptional({ description: 'Required to reject.' })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}

class LabelledAmountDto {
  @ApiProperty() @IsString() @Length(1, 80) label!: string;
  @ApiProperty() @Matches(AMOUNT, amount) amount!: string;
}

class GratuityOverrideDto {
  @ApiProperty() @IsBoolean() eligible!: boolean;
  @ApiProperty() @IsString() @Length(1, 300) reason!: string;
}

export class SaveExitDto {
  @ApiProperty({ description: 'The version read (0 for a settlement not yet started).' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version!: number;

  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(400) leaveDays!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(180) noticeShortfallDays!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(180) noticePayDays!: number;

  @ApiPropertyOptional({ type: GratuityOverrideDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => GratuityOverrideDto)
  gratuityOverride?: GratuityOverrideDto | null;

  @ApiProperty({ type: [LabelledAmountDto] })
  @ValidateNested({ each: true })
  @Type(() => LabelledAmountDto)
  @ArrayMaxSize(10)
  otherEarnings!: LabelledAmountDto[];

  @ApiProperty({ type: [LabelledAmountDto] })
  @ValidateNested({ each: true })
  @Type(() => LabelledAmountDto)
  @ArrayMaxSize(10)
  otherDeductions!: LabelledAmountDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string | null;
}

export class ExitReturnDto extends VersionDto {
  @ApiProperty()
  @IsString()
  @Length(1, 500)
  reason!: string;
}

export class BonusQueryDto {
  @ApiPropertyOptional({ example: '8.33' })
  @IsOptional()
  @Matches(RATE, { message: 'rate must be a percent.' })
  rate?: string;
}

export class ApplyBonusDto {
  @ApiProperty({ example: '8.33' })
  @Matches(RATE, { message: 'ratePercent must be a percent.' })
  ratePercent!: string;

  @ApiProperty({ example: '2026-11' })
  @Matches(MONTH, { message: 'month must be YYYY-MM.' })
  month!: string;
}
