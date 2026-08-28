import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  COMPONENT_APPLICABILITY_STATUSES,
  COMPONENT_CONFIG_STATUSES,
  COMPONENT_INSTANCE_STATUSES,
  RECURRENCES,
  type ComponentApplicabilityStatus,
  type ComponentConfigStatus,
  type ComponentInstanceStatus,
  type Recurrence,
} from '@hsdg/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

export class ConfigureComponentDto {
  @ApiProperty({ description: 'Catalogue component code to configure.', example: 'GSTR1' })
  @IsString()
  @IsNotEmpty()
  serviceComponentCode!: string;

  @ApiPropertyOptional({
    description:
      'Target service line (multi-service, §9–§10). Defaults to the engagement’s primary service.',
  })
  @IsOptional()
  @IsUUID()
  engagementServiceId?: string;

  @ApiPropertyOptional({
    enum: COMPONENT_APPLICABILITY_STATUSES,
    description: 'Defaults from the component catalogue when omitted.',
  })
  @IsOptional()
  @IsIn(COMPONENT_APPLICABILITY_STATUSES)
  applicabilityStatus?: ComponentApplicabilityStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  applicabilityReason?: string;

  @ApiPropertyOptional({ enum: RECURRENCES })
  @IsOptional()
  @IsIn(RECURRENCES)
  frequency?: Recurrence;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerEmployeeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reviewerEmployeeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  epReviewRequired?: boolean;

  @ApiPropertyOptional({ enum: COMPONENT_CONFIG_STATUSES, default: 'draft' })
  @IsOptional()
  @IsIn(COMPONENT_CONFIG_STATUSES)
  status?: ComponentConfigStatus;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @ApiPropertyOptional({ example: '2027-03-31' })
  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class UpdateEngagementComponentDto {
  @ApiPropertyOptional({ enum: COMPONENT_APPLICABILITY_STATUSES })
  @IsOptional()
  @IsIn(COMPONENT_APPLICABILITY_STATUSES)
  applicabilityStatus?: ComponentApplicabilityStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  applicabilityReason?: string | null;

  @ApiPropertyOptional({ enum: RECURRENCES })
  @IsOptional()
  @IsIn(RECURRENCES)
  frequency?: Recurrence;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerEmployeeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reviewerEmployeeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  epReviewRequired?: boolean;

  @ApiPropertyOptional({ enum: COMPONENT_CONFIG_STATUSES })
  @IsOptional()
  @IsIn(COMPONENT_CONFIG_STATUSES)
  status?: ComponentConfigStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({ description: 'Optimistic-lock guard: expected current version.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class ChangeFrequencyDto {
  @ApiProperty({ enum: RECURRENCES, description: 'The new frequency for the component.' })
  @IsIn(RECURRENCES)
  frequency!: Recurrence;
}

export class RemoveEngagementComponentDto {
  @ApiPropertyOptional({ description: 'Reason recorded in the audit trail.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class EngagementComponentListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: COMPONENT_CONFIG_STATUSES })
  @IsOptional()
  @IsIn(COMPONENT_CONFIG_STATUSES)
  status?: ComponentConfigStatus;
}

export class ComponentWorkListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter to one configured component.' })
  @IsOptional()
  @IsUUID()
  componentId?: string;

  @ApiPropertyOptional({ enum: COMPONENT_INSTANCE_STATUSES })
  @IsOptional()
  @IsIn(COMPONENT_INSTANCE_STATUSES)
  status?: ComponentInstanceStatus;
}

export class SetInstanceStatusDto {
  @ApiProperty({ enum: COMPONENT_INSTANCE_STATUSES })
  @IsIn(COMPONENT_INSTANCE_STATUSES)
  status!: ComponentInstanceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Optimistic-lock guard: expected current version.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

/** §40 — record a registration produced by a registration-work instance. */
export class RecordRegistrationDto {
  @ApiProperty({ description: 'The registration number the authority issued.', example: '27ABCDE1234F1Z5' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  registrationNumber!: string;

  @ApiPropertyOptional({ description: 'State code (e.g. for a GSTIN).', example: '27' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  stateCode?: string | null;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsDateString()
  validFrom?: string | null;

  @ApiPropertyOptional({ description: 'Also mark the work instance completed.', default: true })
  @IsOptional()
  @IsBoolean()
  completeInstance?: boolean;
}

export class AddChecklistItemDto {
  @ApiProperty({ description: 'Checklist step label.', example: 'Reconcile ITC against GSTR-2B' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  label!: string;
}

export class SetChecklistItemDto {
  @ApiPropertyOptional({ description: 'Mark the step done / not done.' })
  @IsOptional()
  @IsBoolean()
  isDone?: boolean;

  @ApiPropertyOptional({ description: 'Rename the step.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  label?: string;
}
