import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { COMPLIANCE_CLOCKS, type ComplianceClock } from '@hsdg/contracts';

export class GenerateInstanceDto {
  @ApiProperty({ example: 'GST_GSTR3B' })
  @Matches(/^[A-Z0-9_]{2,50}$/, { message: 'complianceRuleCode must be UPPER_SNAKE' })
  complianceRuleCode!: string;

  @ApiPropertyOptional({
    description: 'Basis date (required for period_end / month_end; overrides fy_end).',
  })
  @IsOptional()
  @IsDateString()
  referenceDate?: string;

  @ApiPropertyOptional({ description: 'Event date (required for event_date basis).' })
  @IsOptional()
  @IsDateString()
  eventDate?: string;

  @ApiPropertyOptional({ description: 'Context for evaluating a conditional rule.' })
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}

export class OverrideInstanceDto {
  @ApiProperty({ enum: COMPLIANCE_CLOCKS, description: 'Which clock to override.' })
  @IsIn(COMPLIANCE_CLOCKS)
  clock!: ComplianceClock;

  @ApiProperty({ example: '2027-11-30' })
  @IsDateString()
  newDate!: string;

  @ApiProperty({ description: 'Why the deadline is being overridden (recorded + audited).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional({ description: 'Evidence reference (e.g. CBDT notification number).' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  evidenceReference?: string;

  @ApiPropertyOptional({
    description: 'Expected version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class CompleteInstanceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    description: 'Expected version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class WaiveInstanceDto {
  @ApiProperty({ description: 'Why the obligation is being waived (recorded + audited).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional({
    description: 'Expected version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}
