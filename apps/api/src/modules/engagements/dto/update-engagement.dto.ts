import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';
import { ENGAGEMENT_STATUSES, type EngagementStatus } from '@hsdg/contracts';

/** Partial update. Note: reassigning the EP is a separate command. */
export class UpdateEngagementDto {
  @ApiPropertyOptional({ enum: ENGAGEMENT_STATUSES })
  @IsOptional()
  @IsIn(ENGAGEMENT_STATUSES)
  status?: EngagementStatus;

  @ApiPropertyOptional({ nullable: true, description: 'Manager employee id, or null to clear.' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  engagementManagerEmployeeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  officeCode?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  plannedStartDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  plannedEndDate?: string | null;

  @ApiPropertyOptional({
    description: 'Expected version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}
