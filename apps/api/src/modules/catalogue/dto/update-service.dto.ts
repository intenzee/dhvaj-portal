import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator';
import { RECURRENCES, type Recurrence } from '@hsdg/contracts';

/** All fields optional — a partial update. */
export class UpdateServiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serviceLineCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  requiredReviewModel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  workflowFamily?: string;

  @ApiPropertyOptional({ enum: RECURRENCES })
  @IsOptional()
  @IsIn(RECURRENCES)
  defaultRecurrence?: Recurrence;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Expected version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}
