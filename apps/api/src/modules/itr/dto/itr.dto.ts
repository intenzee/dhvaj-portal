import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CLIENT_REMINDER_CHANNEL,
  ITR_FORMS,
  ITR_INCOME_HEADS,
  ITR_INCOME_SOURCES,
  ITR_INTIMATION_KINDS,
  ITR_INTIMATION_RESULTS,
  ITR_REFUND_STATUSES,
  ITR_REGIMES,
  ITR_RETURN_TYPES,
  ITR_VERIFY_MODES,
  type AddItrIncomeLineInput,
  type ClientReminderChannel,
  type EVerifyItrInput,
  type ImportItrStatementInput,
  type ItrForm,
  type ItrIncomeHead,
  type ItrIncomeSource,
  type ItrIntimationKind,
  type ItrIntimationResult,
  type ItrRefundStatus,
  type ItrRegime,
  type ItrReturnType,
  type ItrVerifyMode,
  type MoveItrRefundInput,
  type OpenItrReturnInput,
  type RecordItrIntimationInput,
  type RemindItrVerifyInput,
  type UpdateItrIncomeLineInput,
  type UpdateItrReturnInput,
} from '@hsdg/contracts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Rupees and paise, as a decimal string. */
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const SIGNED_AMOUNT = /^-?\d{1,12}(\.\d{1,2})?$/;

class VersionDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class ItrSeasonQueryDto {
  @ApiProperty({ example: '2025-26', description: 'The financial year of the income.' })
  @Matches(/^\d{4}-\d{2}$/)
  financialYear!: string;

  @ApiPropertyOptional({ enum: ['mine', 'team', 'all'] })
  @IsOptional()
  @IsIn(['mine', 'team', 'all'])
  scope?: 'mine' | 'team' | 'all';
}

export class OpenItrReturnDto implements OpenItrReturnInput {
  @ApiProperty()
  @IsUUID()
  complianceInstanceId!: string;
}

export class UpdateItrReturnDto extends VersionDto implements UpdateItrReturnInput {
  @ApiPropertyOptional({ enum: ITR_FORMS, nullable: true })
  @IsOptional()
  @IsIn([...ITR_FORMS, null])
  itrForm?: ItrForm | null;

  @ApiPropertyOptional({ enum: ITR_REGIMES, nullable: true })
  @IsOptional()
  @IsIn([...ITR_REGIMES, null])
  regime?: ItrRegime | null;

  @ApiPropertyOptional({ enum: ITR_RETURN_TYPES })
  @IsOptional()
  @IsIn(ITR_RETURN_TYPES)
  returnType?: ItrReturnType;

  @ApiPropertyOptional({ example: '12500.00', nullable: true })
  @IsOptional()
  @Matches(AMOUNT)
  refundClaimed?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;
}

export class EVerifyItrDto extends VersionDto implements EVerifyItrInput {
  @ApiProperty()
  @Matches(DATE)
  eVerifiedOn!: string;

  @ApiProperty({ enum: ITR_VERIFY_MODES })
  @IsIn(ITR_VERIFY_MODES)
  mode!: ItrVerifyMode;
}

export class MoveItrRefundDto extends VersionDto implements MoveItrRefundInput {
  @ApiProperty({ enum: ITR_REFUND_STATUSES })
  @IsIn(ITR_REFUND_STATUSES)
  to!: ItrRefundStatus;

  @ApiPropertyOptional({ example: '12500.00' })
  @IsOptional()
  @Matches(AMOUNT)
  amount?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE)
  on?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class RecordItrIntimationDto extends VersionDto implements RecordItrIntimationInput {
  @ApiProperty({ enum: ITR_INTIMATION_KINDS })
  @IsIn(ITR_INTIMATION_KINDS)
  kind!: ItrIntimationKind;

  @ApiProperty({ example: 'CPC/2627/A1/123456789' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  referenceNo!: string;

  @ApiProperty()
  @Matches(DATE)
  issuedOn!: string;

  @ApiProperty()
  @Matches(DATE)
  receivedOn!: string;

  @ApiPropertyOptional({ enum: ITR_INTIMATION_RESULTS })
  @IsOptional()
  @IsIn(ITR_INTIMATION_RESULTS)
  result?: ItrIntimationResult;

  @ApiPropertyOptional({ example: '8400.00' })
  @IsOptional()
  @Matches(AMOUNT)
  amount?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  openNotice?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  summary?: string | null;
}

export class RemindItrVerifyDto implements RemindItrVerifyInput {
  @ApiPropertyOptional({ enum: Object.values(CLIENT_REMINDER_CHANNEL) })
  @IsOptional()
  @IsIn(Object.values(CLIENT_REMINDER_CHANNEL))
  channel?: ClientReminderChannel;
}

export class ImportItrStatementDto implements ImportItrStatementInput {
  @ApiProperty({ enum: ITR_INCOME_SOURCES })
  @IsIn(ITR_INCOME_SOURCES)
  source!: ItrIncomeSource;

  @ApiProperty({ example: 'ABCPE1234F-2026.txt' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename!: string;

  @ApiProperty({ description: 'The file, base64.' })
  @IsString()
  @IsNotEmpty()
  contentBase64!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  replace?: boolean;
}

export class AddItrIncomeLineDto implements AddItrIncomeLineInput {
  @ApiProperty({ enum: ITR_INCOME_SOURCES })
  @IsIn(ITR_INCOME_SOURCES)
  source!: ItrIncomeSource;

  @ApiProperty({ enum: ITR_INCOME_HEADS })
  @IsIn(ITR_INCOME_HEADS)
  head!: ItrIncomeHead;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  section?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  payerName?: string | null;

  @ApiPropertyOptional({ example: 'MUMX12345A' })
  @IsOptional()
  @Matches(/^[A-Za-z]{4}[0-9]{5}[A-Za-z]$/)
  payerTan?: string | null;

  @ApiProperty({ example: '1200000.00' })
  @Matches(SIGNED_AMOUNT)
  amount!: string;

  @ApiPropertyOptional({ example: '110000.00' })
  @IsOptional()
  @Matches(SIGNED_AMOUNT)
  taxDeducted?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE)
  transactionOn?: string | null;
}

export class UpdateItrIncomeLineDto implements UpdateItrIncomeLineInput {
  @ApiProperty({ enum: ITR_INCOME_HEADS })
  @IsIn(ITR_INCOME_HEADS)
  head!: ItrIncomeHead;
}
