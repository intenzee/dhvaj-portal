import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import { RECURRENCES, type Recurrence } from '@hsdg/contracts';

/** All fields optional — a partial update. */
export class UpdateServiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9_]{2,30}$/, { message: 'serviceLineCode must be UPPER_SNAKE (A-Z, 0-9, _)' })
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
