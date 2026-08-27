import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** Roll the recurring-work horizon forward (spec §18). */
export class RollHorizonDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 120,
    description: 'Override the firm-configured horizon, in months from today.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  horizonMonths?: number;

  @ApiPropertyOptional({ description: 'Scope the sweep to a single engagement.' })
  @IsOptional()
  @IsUUID()
  engagementId?: string;
}
