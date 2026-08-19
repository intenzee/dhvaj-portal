import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Partial update of non-lifecycle fields. Reassigning the EP is a separate
 * command. Status is deliberately NOT here (Phase 6): lifecycle state moves
 * only through the guarded transition endpoints (POST /engagements/:id/<action>).
 */
export class UpdateEngagementDto {
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
