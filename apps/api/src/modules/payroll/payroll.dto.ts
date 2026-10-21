import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  IFSC_PATTERN,
  PAN_PATTERN,
  PAY_KINDS,
  PAYROLL_INPUT_KINDS,
  STATUTORY_KINDS,
  type PayKind,
  type PayrollInputKind,
  type StatutoryKind,
} from '@hsdg/contracts';

const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export class MonthParamDto {
  @ApiProperty({ example: '2026-10' })
  @Matches(MONTH, { message: 'month must be YYYY-MM.' })
  month!: string;
}

export class MonthEmployeeParamDto extends MonthParamDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;
}

export class PayComponentDto {
  @ApiProperty({ example: 'basic' })
  @Matches(/^[a-z][a-z0-9_]{1,29}$/, { message: 'code must be lower-case letters, digits or _.' })
  code!: string;

  @ApiProperty({ example: 'Basic' })
  @IsString()
  @Length(1, 60)
  label!: string;

  @ApiProperty({ example: '25000.00' })
  @Matches(AMOUNT, { message: 'monthly must be an amount with up to two decimals.' })
  monthly!: string;

  @ApiPropertyOptional({ description: 'Counts as wages for PF and gratuity (basic, DA).' })
  @IsOptional()
  @IsBoolean()
  pfWage?: boolean;
}

export class ProposeStructureDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiProperty({ example: '2026-10-01' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiProperty({ enum: PAY_KINDS })
  @IsIn(PAY_KINDS)
  kind!: PayKind;

  @ApiProperty({ example: '600000.00' })
  @Matches(AMOUNT, { message: 'ctc must be an amount with up to two decimals.' })
  ctc!: string;

  @ApiProperty({ type: [PayComponentDto] })
  @ValidateNested({ each: true })
  @Type(() => PayComponentDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  components!: PayComponentDto[];

  @ApiProperty()
  @IsBoolean()
  pfApplicable!: boolean;

  @ApiProperty()
  @IsBoolean()
  esiApplicable!: boolean;

  @ApiProperty()
  @IsBoolean()
  ptApplicable!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}

export class DecideDto {
  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  @ApiPropertyOptional({ description: 'Required to reject.' })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}

export class PayDetailsDto {
  @ApiProperty()
  @IsString()
  @Length(1, 200)
  accountHolder!: string;

  @ApiProperty({ example: '001234567890' })
  @Matches(/^[0-9A-Za-z]{6,20}$/, { message: 'accountNumber must be 6–20 letters or digits.' })
  accountNumber!: string;

  @ApiProperty({ example: 'HDFC0001234' })
  @Matches(IFSC_PATTERN, { message: 'ifsc is not a valid IFSC.' })
  ifsc!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 120)
  bankName?: string;

  @ApiPropertyOptional({ example: 'ABCDE1234F' })
  @IsOptional()
  @Matches(PAN_PATTERN, { message: 'pan is not a valid PAN.' })
  pan?: string;

  @ApiPropertyOptional({ example: '100200300400' })
  @IsOptional()
  @Matches(/^[0-9]{12}$/, { message: 'uan must be 12 digits.' })
  uan?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[0-9]{10,17}$/, { message: 'esiNumber must be 10–17 digits.' })
  esiNumber?: string;

  @ApiPropertyOptional({ description: 'Only the last four digits are kept.' })
  @IsOptional()
  @Matches(/^[0-9]{4}$/, { message: 'aadhaarLast4 must be four digits.' })
  aadhaarLast4?: string;
}

export class BankChangeDto {
  @ApiProperty()
  @IsString()
  @Length(1, 200)
  accountHolder!: string;

  @ApiProperty()
  @Matches(/^[0-9A-Za-z]{6,20}$/, { message: 'accountNumber must be 6–20 letters or digits.' })
  accountNumber!: string;

  @ApiProperty()
  @Matches(IFSC_PATTERN, { message: 'ifsc is not a valid IFSC.' })
  ifsc!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 120)
  bankName?: string;
}

export class DecideBankChangeDto {
  @ApiProperty({ enum: ['verify', 'reject'] })
  @IsIn(['verify', 'reject'])
  decision!: 'verify' | 'reject';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}

export class RevealDto {
  @ApiProperty({ enum: ['account', 'pan'] })
  @IsIn(['account', 'pan'])
  field!: 'account' | 'pan';
}

export class PayrollInputDto {
  @ApiProperty({ enum: PAYROLL_INPUT_KINDS })
  @IsIn(PAYROLL_INPUT_KINDS)
  kind!: PayrollInputKind;

  @ApiProperty({ example: '1500.00' })
  @Matches(AMOUNT, { message: 'amount must be an amount with up to two decimals.' })
  amount!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 300)
  note?: string;
}

/** Replaces one person's inputs for the month. */
export class SetInputsDto {
  @ApiProperty({ minimum: 0, maximum: 31 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(31)
  lossOfPayDays!: number;

  @ApiProperty({ type: [PayrollInputDto] })
  @ValidateNested({ each: true })
  @Type(() => PayrollInputDto)
  @ArrayMaxSize(30)
  inputs!: PayrollInputDto[];
}

export class CreateRunDto {
  @ApiProperty({ example: '2026-10' })
  @Matches(MONTH, { message: 'month must be YYYY-MM.' })
  month!: string;

  @ApiProperty({ enum: PAY_KINDS })
  @IsIn(PAY_KINDS)
  kind!: PayKind;
}

export class VersionDto {
  @ApiProperty({ description: 'The version read; a stale one is a 409.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class ReturnRunDto extends VersionDto {
  @ApiProperty()
  @IsString()
  @Length(1, 500)
  reason!: string;
}

export class MarkPaidDto extends VersionDto {
  @ApiProperty({ description: "The bank's reference for the bulk transfer." })
  @IsString()
  @Length(1, 100)
  bankReference!: string;
}

export class RecordChallanDto {
  @ApiProperty()
  @IsString()
  @Length(1, 60)
  challanNumber!: string;

  @ApiProperty({ example: '2026-11-14' })
  @IsDateString()
  paidOn!: string;

  @ApiProperty({ example: '12345.00' })
  @Matches(AMOUNT, { message: 'amount must be an amount with up to two decimals.' })
  amount!: string;
}

export class StatutoryKindParamDto {
  @ApiProperty({ example: '2026-10' })
  @Matches(MONTH, { message: 'month must be YYYY-MM.' })
  month!: string;

  @ApiProperty({ enum: STATUTORY_KINDS })
  @IsIn(STATUTORY_KINDS)
  kind!: StatutoryKind;
}

export class SaveSettingsDto {
  @ApiProperty({ example: '2027-04-01' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiProperty({ description: 'PaySettings plus ptSlabsByOffice and stipendMinimumByOffice.' })
  @IsObject()
  rules!: Record<string, unknown>;
}

export class AddApproverDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;
}
