import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ICFR_BORROWING_DATA_BASES,
  ICFR_BORROWING_SOURCES,
  ICFR_CONCLUSIONS,
  ICFR_PROFESSIONAL_ACTIONS,
  type IcfrBorrowingDataBasis,
  type IcfrBorrowingSource,
  type IcfrOutcome,
  type IcfrProfessionalAction,
} from '@hsdg/contracts';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One IFC-02 borrowing balance (spec §8). */
export class IcfrBorrowingPointDto {
  @ApiProperty({ description: 'ISO date of the balance.' })
  @Matches(ISO_DATE)
  asOn!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  lender!: string;

  @ApiProperty({ enum: ICFR_BORROWING_SOURCES })
  @IsIn(ICFR_BORROWING_SOURCES)
  source!: IcfrBorrowingSource;

  @ApiProperty({ description: 'Outstanding (₹) on that date.' })
  @IsNumber()
  @Min(0)
  amount!: number;
}

/** One IFC-03 §137 / §92 filing record (spec §9). */
export class IcfrFilingRecordDto {
  @ApiProperty({ example: 'AOC-4' })
  @IsString()
  @MaxLength(20)
  form!: string;

  @ApiProperty({ enum: ['137', '92'] })
  @IsIn(['137', '92'])
  section!: '137' | '92';

  @ApiPropertyOptional({ example: '2023-24' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  period?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(ISO_DATE)
  dueDate?: string | null;

  @ApiPropertyOptional({ description: 'ISO date filed; omit / null = not filed.' })
  @IsOptional()
  @Matches(ISO_DATE)
  filedOn?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  srn?: string | null;

  @ApiProperty({ enum: ['compliance_calendar', 'mca', 'manual'] })
  @IsIn(['compliance_calendar', 'mca', 'manual'])
  source!: 'compliance_calendar' | 'mca' | 'manual';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

/** Capture the 02.5-specific facts — IFC-01 / IFC-02 / IFC-03 (spec §7–§9). */
export class SetIcfrFactsDto {
  @ApiPropertyOptional({
    description:
      'Documented maximum aggregate covered borrowings (₹) at any point in the year, when no schedule is entered.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  peakCoveredBorrowings?: number | null;

  @ApiPropertyOptional({ description: 'Date of the documented peak.' })
  @IsOptional()
  @Matches(ISO_DATE)
  peakDate?: string | null;

  @ApiPropertyOptional({ type: [IcfrBorrowingPointDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IcfrBorrowingPointDto)
  borrowingSchedule?: IcfrBorrowingPointDto[] | null;

  @ApiPropertyOptional({ enum: ICFR_BORROWING_DATA_BASES })
  @IsOptional()
  @IsIn(ICFR_BORROWING_DATA_BASES)
  borrowingDataBasis?: IcfrBorrowingDataBasis | null;

  @ApiPropertyOptional({
    description:
      'Documented filing answer when no filing record exists (true = default, false = none, null = unknown).',
  })
  @IsOptional()
  @IsBoolean()
  filingDefault?: boolean | null;

  @ApiPropertyOptional({ type: [IcfrFilingRecordDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IcfrFilingRecordDto)
  filings?: IcfrFilingRecordDto[] | null;

  @ApiPropertyOptional({ description: 'Documented evidence supporting the filing answer.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  filingEvidence?: string | null;

  @ApiPropertyOptional({ description: 'IFC-01 turnover per the latest audited FS (₹).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  auditedTurnover?: number | null;

  @ApiPropertyOptional({ example: '2023-24' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  auditedTurnoverPeriod?: string | null;

  @ApiPropertyOptional({ example: 'Audited financial statements FY 2023-24' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  auditedTurnoverSource?: string | null;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(0)
  version!: number;
}

/** IFC-04: Confirm / Override / Information Pending (spec §11). */
export class RecordIcfrDecisionDto {
  @ApiPropertyOptional({ enum: ICFR_PROFESSIONAL_ACTIONS })
  @IsOptional()
  @IsIn(ICFR_PROFESSIONAL_ACTIONS)
  action?: IcfrProfessionalAction;

  @ApiPropertyOptional({ enum: ICFR_CONCLUSIONS })
  @IsOptional()
  @IsIn(ICFR_CONCLUSIONS)
  conclusion?: IcfrOutcome;

  @ApiPropertyOptional({ description: 'Override reason (mandatory on override).' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  basis?: string;

  @ApiPropertyOptional({ description: 'Override technical basis (mandatory on override).' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  technicalBasis?: string;

  @ApiPropertyOptional({
    description: 'Override supporting evidence (or link a file to 02.5).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  supportingEvidence?: string;

  @ApiPropertyOptional({ description: 'Information Pending — what is pending.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  pendingReason?: string;

  @ApiPropertyOptional({ description: 'Downstream impact note.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  impact?: string;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(0)
  version!: number;
}

/** IFC-04 Engagement Partner approval of a significant override / complex assessment. */
export class PartnerApproveIcfrDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(0)
  version!: number;
}
