import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
  CARO_BORROWING_DATA_BASES,
  CARO_CONCLUSIONS,
  CARO_PROFESSIONAL_ACTIONS,
  type CaroBorrowingDataBasis,
  type CaroOutcome,
  type CaroProfessionalAction,
} from '@hsdg/contracts';

/** One bank/FI balance in the year (spec §7 — aggregate "at any point" test). */
export class CaroBorrowingPointDto {
  @ApiProperty({ description: 'ISO date of the balance.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  asOn!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  lender!: string;

  @ApiProperty({ enum: ['bank', 'financial_institution'] })
  @IsIn(['bank', 'financial_institution'])
  lenderType!: 'bank' | 'financial_institution';

  @ApiProperty({ description: 'Outstanding on that date (₹), all covered facilities.' })
  @IsNumber()
  @Min(0)
  amount!: number;
}

/** Capture the 02.4-specific CARO measurement facts (spec §6, §7). */
export class SetCaroFactsDto {
  @ApiPropertyOptional({
    description: 'Holding/subsidiary of a public company (null = not yet confirmed).',
    nullable: true,
  })
  @IsOptional()
  @IsBoolean()
  isHoldingOrSubsidiaryOfPublic?: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  publicGroupNote?: string | null;

  @ApiPropertyOptional({ description: 'Paid-up capital at the balance-sheet date (₹).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  paidUpCapital?: number | null;

  @ApiPropertyOptional({
    description: 'Reserves & surplus at the balance-sheet date (₹; may be negative).',
  })
  @IsOptional()
  @IsNumber()
  reservesAndSurplus?: number | null;

  @ApiPropertyOptional({ description: 'Paid-up capital + reserves & surplus total (₹).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  capitalPlusReserves?: number | null;

  @ApiPropertyOptional({ type: [CaroBorrowingPointDto], nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => CaroBorrowingPointDto)
  borrowingSchedule?: CaroBorrowingPointDto[] | null;

  @ApiPropertyOptional({ enum: CARO_BORROWING_DATA_BASES, nullable: true })
  @IsOptional()
  @IsIn(CARO_BORROWING_DATA_BASES)
  borrowingDataBasis?: CaroBorrowingDataBasis | null;

  @ApiPropertyOptional({
    description: 'Aggregate bank/FI borrowings — peak at any point in the year, not year-end (₹).',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  peakBankFiBorrowings?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  revenueFromOperations?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  otherIncome?: number | null;

  @ApiPropertyOptional({ description: 'Revenue from discontinuing operations (₹).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discontinuedOperationsRevenue?: number | null;

  @ApiPropertyOptional({ description: 'Total revenue on the CARO measurement basis (₹).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalRevenue?: number | null;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(0)
  version!: number;
}

/** CARO-06: confirm / override / information pending (spec §9). */
export class RecordCaroDecisionDto {
  @ApiPropertyOptional({ enum: CARO_PROFESSIONAL_ACTIONS })
  @IsOptional()
  @IsIn(CARO_PROFESSIONAL_ACTIONS)
  action?: CaroProfessionalAction;

  @ApiPropertyOptional({ enum: CARO_CONCLUSIONS })
  @IsOptional()
  @IsIn(CARO_CONCLUSIONS)
  conclusion?: CaroOutcome;

  @ApiPropertyOptional({ description: 'Override reason (mandatory on override).' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  basis?: string;

  @ApiPropertyOptional({ description: 'Technical basis (mandatory on override).' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  technicalBasis?: string;

  @ApiPropertyOptional({
    description: 'Supporting evidence (mandatory on override unless a file is linked).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  supportingEvidence?: string;

  @ApiPropertyOptional({ description: 'Blocking fact(s) for Information Pending.' })
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

/** CARO-06 Engagement Partner approval. */
export class PartnerApproveCaroDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  version!: number;
}
