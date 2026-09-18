import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PLANNING_ITEM_STATE, type PlanningItemState } from '@hsdg/contracts';

/** Update a planning sub-area's state and/or narrative (§21). */
export class UpdatePlanningItemDto {
  @ApiPropertyOptional({ enum: Object.values(PLANNING_ITEM_STATE) })
  @IsOptional()
  @IsIn(Object.values(PLANNING_ITEM_STATE))
  state?: PlanningItemState;

  @ApiPropertyOptional({ description: 'Planning narrative for the sub-area.' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  narrative?: string;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen for this item.' })
  @IsInt()
  @Min(1)
  version!: number;
}

/** Set / update the materiality record (§21). */
export class SetMaterialityDto {
  @ApiPropertyOptional({ description: 'Overall materiality (rupees).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  overallMateriality?: number;

  @ApiPropertyOptional({ description: 'Performance materiality (rupees).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  performanceMateriality?: number;

  @ApiPropertyOptional({ description: 'Clearly-trivial threshold (rupees).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  clearlyTrivialThreshold?: number;

  @ApiPropertyOptional({ description: 'Benchmark, e.g. "5% of profit before tax".' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  benchmark?: string;

  @ApiPropertyOptional({ description: 'Basis / rationale for the materiality figures.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  basis?: string;

  @ApiPropertyOptional({ description: 'Optimistic-concurrency version, when updating.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

/** Approve Planning (§21). */
export class ApprovePlanningDto {
  @ApiPropertyOptional({ description: 'The planning memo / rationale recorded with approval.' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  memo?: string;
}
