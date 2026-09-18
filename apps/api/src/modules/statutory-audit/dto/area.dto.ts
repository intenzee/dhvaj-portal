import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AREA_CONCLUSION_STATE,
  AREA_RISK_LEVEL,
  type AreaConclusionState,
  type AreaRiskLevel,
} from '@hsdg/contracts';

/**
 * Update the §11 professional detail on an audit area (SA-5). All fields optional
 * (PATCH semantics — explicit null clears); detailVersion is required for
 * optimistic concurrency. "Save Draft" sends conclusionState 'draft'; "Submit for
 * Review" sends 'submitted'.
 */
export class UpdateAreaDetailDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerEmployeeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reviewerEmployeeId?: string | null;

  @ApiPropertyOptional({ enum: Object.values(AREA_RISK_LEVEL) })
  @IsOptional()
  @IsIn(Object.values(AREA_RISK_LEVEL))
  riskLevel?: AreaRiskLevel;

  @ApiPropertyOptional({ description: 'Area materiality (rupees).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  materiality?: number;

  @ApiPropertyOptional({ description: 'Internal deadline (YYYY-MM-DD).' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Current-year balance (rupees).' })
  @IsOptional()
  @IsNumber()
  financialCurrent?: number;

  @ApiPropertyOptional({ description: 'Prior-year balance (rupees).' })
  @IsOptional()
  @IsNumber()
  financialPrior?: number;

  @ApiPropertyOptional({ description: 'Source of the financial data, e.g. the FS workbook.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  financialSource?: string;

  @ApiPropertyOptional({ description: 'The structured area conclusion (§11).' })
  @IsOptional()
  @IsString()
  @MaxLength(16000)
  conclusion?: string;

  @ApiPropertyOptional({ enum: Object.values(AREA_CONCLUSION_STATE) })
  @IsOptional()
  @IsIn(Object.values(AREA_CONCLUSION_STATE))
  conclusionState?: AreaConclusionState;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen for this area.' })
  @IsInt()
  @Min(1)
  detailVersion!: number;
}
