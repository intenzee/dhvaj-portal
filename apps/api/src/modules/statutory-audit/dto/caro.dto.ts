import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { CARO_CONCLUSIONS, type CaroOutcome } from '@hsdg/contracts';

/** Capture the four 02.4-specific CARO-measurement facts (guide §9.4). */
export class SetCaroFactsDto {
  @ApiPropertyOptional({
    description: 'Private company that is a holding/subsidiary of a public company.',
  })
  @IsOptional()
  @IsBoolean()
  isHoldingOrSubsidiaryOfPublic?: boolean;

  @ApiPropertyOptional({ description: 'Paid-up capital + reserves at the balance-sheet date (₹).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  capitalPlusReserves?: number;

  @ApiPropertyOptional({
    description: 'Aggregate bank/FI borrowings — peak at any point in the year, not year-end (₹).',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  peakBankFiBorrowings?: number;

  @ApiPropertyOptional({ description: 'Total revenue on the CARO measurement basis (₹).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalRevenue?: number;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(1)
  version!: number;
}

/** Record the professional CARO conclusion for 02.4 (override needs a basis, §19). */
export class RecordCaroDecisionDto {
  @ApiProperty({ enum: CARO_CONCLUSIONS })
  @IsIn(CARO_CONCLUSIONS)
  conclusion!: CaroOutcome;

  @ApiPropertyOptional({
    description: 'Required when the conclusion overrides the system suggestion.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  basis?: string;

  @ApiPropertyOptional({ description: 'Downstream impact note.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  impact?: string;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(1)
  version!: number;
}
