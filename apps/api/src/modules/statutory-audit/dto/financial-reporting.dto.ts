import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { REPORTING_FRAMEWORK_CONCLUSIONS, type ReportingFrameworkOutcome } from '@hsdg/contracts';

/** Capture the 02.2-specific facts (guide §9.2 — captured once here). */
export class SetFinancialReportingFactsDto {
  @ApiPropertyOptional({
    description: 'Listed only on an SME exchange (roadmap listing trigger n/a).',
  })
  @IsOptional()
  @IsBoolean()
  isListedOnSmeExchange?: boolean;

  @ApiPropertyOptional({ description: 'Ind AS applied in a prior year (continuing status).' })
  @IsOptional()
  @IsBoolean()
  priorIndAs?: boolean;

  @ApiPropertyOptional({ description: 'Ind AS voluntarily adopted.' })
  @IsOptional()
  @IsBoolean()
  voluntaryIndAs?: boolean;

  @ApiPropertyOptional({ description: 'A group company applies Ind AS (Rule 4 group trigger).' })
  @IsOptional()
  @IsBoolean()
  groupTriggersIndAs?: boolean;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(1)
  version!: number;
}

/** Record the professional conclusion for 02.2 (override needs a basis, §19). */
export class RecordFinancialReportingDecisionDto {
  @ApiProperty({ enum: REPORTING_FRAMEWORK_CONCLUSIONS })
  @IsIn(REPORTING_FRAMEWORK_CONCLUSIONS)
  conclusion!: ReportingFrameworkOutcome;

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
