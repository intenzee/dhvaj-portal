import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  COMPLIANCE_CLOCKS,
  COMPLIANCE_STATUSES,
  DEADLINE_LAYER_TYPES,
  DUE_DATE_CATEGORIES,
  type ComplianceClock,
  type ComplianceStatus,
  type DeadlineLayerType,
  type DueDateCategory,
} from '@hsdg/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

/** Parse a querystring boolean correctly — `Boolean('false')` is `true`. */
const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

/** `?status=` filter on the per-engagement obligation list. */
export class ComplianceInstanceListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: COMPLIANCE_STATUSES })
  @IsOptional()
  @IsIn(COMPLIANCE_STATUSES)
  status?: ComplianceStatus;
}

/** Firm-wide compliance calendar filters. */
export class ComplianceCalendarQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: COMPLIANCE_STATUSES })
  @IsOptional()
  @IsIn(COMPLIANCE_STATUSES)
  status?: ComplianceStatus;

  @ApiPropertyOptional({ description: 'Effective statutory deadline on/after this date.' })
  @IsOptional()
  @IsDateString()
  dueFrom?: string;

  @ApiPropertyOptional({ description: 'Effective statutory deadline on/before this date.' })
  @IsOptional()
  @IsDateString()
  dueTo?: string;

  @ApiPropertyOptional({
    description: 'Only open obligations past their effective statutory deadline.',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  overdueOnly?: boolean;

  @ApiPropertyOptional({
    enum: DUE_DATE_CATEGORIES,
    description: 'Filter the calendar by frozen due-date category (§2).',
  })
  @IsOptional()
  @IsIn(DUE_DATE_CATEGORIES)
  dueDateCategory?: DueDateCategory;
}

/** Bulk-generate obligations for all active rules on the engagement's service. */
export class GenerateForServiceDto {
  @ApiPropertyOptional({ description: 'Context for evaluating conditional rules.' })
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}

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

/** Apply a government extension (§19) overlay to this obligation's statutory clock. */
export class ApplyExtensionDto {
  @ApiProperty({ description: 'Id of the government extension (§19) to apply.' })
  @IsUUID()
  governmentExtensionId!: string;

  @ApiPropertyOptional({
    description: 'Expected version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

/** Remove a government extension overlay, reverting to the original clock. */
export class ClearExtensionDto {
  @ApiPropertyOptional({
    description: 'Expected version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

/** Add a deadline layer (§16) — a preparation target or review/stage gate. */
export class AddDeadlineLayerDto {
  @ApiProperty({ enum: DEADLINE_LAYER_TYPES })
  @IsIn(DEADLINE_LAYER_TYPES)
  layerType!: DeadlineLayerType;

  @ApiProperty({ example: 'Manager review' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;

  @ApiProperty({ enum: DUE_DATE_CATEGORIES, description: 'How this layer is generated (§2).' })
  @IsIn(DUE_DATE_CATEGORIES)
  dueDateCategory!: DueDateCategory;

  @ApiProperty({ example: '2026-01-15' })
  @IsDateString()
  dueDate!: string;

  @ApiPropertyOptional({ description: 'Owner (employee id) accountable for this layer.' })
  @IsOptional()
  @IsUUID()
  ownerEmployeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class CompleteDeadlineLayerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Expected version (stale ⇒ 409).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class WaiveDeadlineLayerDto {
  @ApiProperty({ description: 'Why the layer is being waived (recorded + audited).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional({ description: 'Expected version (stale ⇒ 409).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

/** Filters for the flattened calendar-events stream (§16). */
export class ComplianceEventsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only events for this engagement.' })
  @IsOptional()
  @IsUUID()
  engagementId?: string;

  @ApiPropertyOptional({ description: 'Event due date on/after this date.' })
  @IsOptional()
  @IsDateString()
  dueFrom?: string;

  @ApiPropertyOptional({ description: 'Event due date on/before this date.' })
  @IsOptional()
  @IsDateString()
  dueTo?: string;

  @ApiPropertyOptional({ description: 'Only open events.' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  openOnly?: boolean;

  @ApiPropertyOptional({ description: 'Only open events past their due date.' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  overdueOnly?: boolean;
}
