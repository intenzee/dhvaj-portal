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
import { ICFR_CONCLUSIONS, type IcfrOutcome } from '@hsdg/contracts';

/** Capture the two 02.5-specific ICFR facts (guide §9.5). */
export class SetIcfrFactsDto {
  @ApiPropertyOptional({
    description:
      'Peak aggregate covered borrowings — banks + FIs + any body corporate, at any point in the year (₹).',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  peakCoveredBorrowings?: number;

  @ApiPropertyOptional({
    description: 'Default in filing financial statements (§137) or annual return (§92).',
  })
  @IsOptional()
  @IsBoolean()
  filingDefault?: boolean;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(1)
  version!: number;
}

/** Record the professional ICFR conclusion for 02.5 (override needs a basis, §19). */
export class RecordIcfrDecisionDto {
  @ApiProperty({ enum: ICFR_CONCLUSIONS })
  @IsIn(ICFR_CONCLUSIONS)
  conclusion!: IcfrOutcome;

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
