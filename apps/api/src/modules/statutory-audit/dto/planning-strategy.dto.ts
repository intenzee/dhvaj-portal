import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ACCEPTANCE_CARRY_FORWARD_ACTIONS,
  PLANNING_AFFECTED_MODULES,
  PLANNING_CONSIDERATION_ASSESSMENTS,
  PLANNING_CONSIDERATION_KINDS,
  PLANNING_MATTER_CATEGORIES,
  PLANNING_MATTER_ORIGINS,
  PLANNING_MATTER_STATUSES,
  PRIOR_YEAR_ASSESSMENTS,
  PRIOR_YEAR_MATTER_TYPES,
  type AcceptanceCarryForwardAction,
  type PlanningAffectedModule,
  type PlanningConsiderationAssessment,
  type PlanningConsiderationKind,
  type PlanningMatterCategory,
  type PlanningMatterOrigin,
  type PlanningMatterStatus,
  type PriorYearAssessment,
  type PriorYearMatterType,
} from '@hsdg/contracts';

const AFFECTED_MODULES = [...PLANNING_AFFECTED_MODULES];

/** Add a Manager strategic timing / resource consideration (03.1 §13.2–13.3). */
export class CreatePlanningConsiderationDto {
  @ApiProperty({ enum: PLANNING_CONSIDERATION_KINDS })
  @IsIn(PLANNING_CONSIDERATION_KINDS)
  kind!: PlanningConsiderationKind;

  @ApiProperty({ description: 'Strategic only — no dates (03.11) or named staff (03.8).' })
  @IsString()
  @MaxLength(300)
  label!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  basis?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  signalId?: string;
}

export class AssessPlanningConsiderationDto {
  @ApiProperty({ enum: PLANNING_CONSIDERATION_ASSESSMENTS })
  @IsIn(PLANNING_CONSIDERATION_ASSESSMENTS)
  assessment!: PlanningConsiderationAssessment;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  rationale?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

/** 03.1.6 — controlled manual addition of a prior-year matter (v1). */
export class CreatePriorYearMatterDto {
  @ApiProperty({ enum: PRIOR_YEAR_MATTER_TYPES })
  @IsIn(PRIOR_YEAR_MATTER_TYPES)
  matterType!: PriorYearMatterType;

  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  description!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceEvidence?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  documentId?: string;
}

export class AssessPriorYearMatterDto {
  @ApiProperty({ enum: PRIOR_YEAR_ASSESSMENTS })
  @IsIn(PRIOR_YEAR_ASSESSMENTS)
  assessment!: PriorYearAssessment;

  @ApiPropertyOptional({ description: 'Required for Resolved.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  assessmentNote?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  createSignal?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  linkSignalId?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

/** 03.1.7 — conclude an unresolved/conditional Section 01 acceptance matter. */
export class ConcludeAcceptanceMatterDto {
  @ApiProperty({ enum: ACCEPTANCE_CARRY_FORWARD_ACTIONS })
  @IsIn(ACCEPTANCE_CARRY_FORWARD_ACTIONS)
  action!: AcceptanceCarryForwardAction;

  @ApiPropertyOptional({ description: 'Required for link_signal.' })
  @IsOptional()
  @IsUUID()
  signalId?: string;

  @ApiPropertyOptional({ description: 'Required for no_implication.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  reason?: string;

  @ApiProperty({ description: '0 when concluding for the first time.' })
  @IsInt()
  @Min(0)
  version!: number;
}

/** 03.1.8 — the initial engagement-team planning discussion (saved whole). */
export class UpdatePlanningDiscussionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  discussionDate?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  participantEmployeeIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  signalIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  focusIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  additionalMatters?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  skepticismAreas?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  observations?: string;

  @ApiProperty({ description: '0 when recording for the first time.' })
  @IsInt()
  @Min(0)
  version!: number;
}

/** §18 — raise a Planning Matter / Action. */
export class CreatePlanningMatterDto {
  @ApiProperty({ enum: PLANNING_MATTER_ORIGINS })
  @IsIn(PLANNING_MATTER_ORIGINS)
  origin!: PlanningMatterOrigin;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  signalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  focusId?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  title!: string;

  @ApiProperty({ enum: PLANNING_MATTER_CATEGORIES })
  @IsIn(PLANNING_MATTER_CATEGORIES)
  category!: PlanningMatterCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerEmployeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  partnerAttention?: boolean;

  @ApiPropertyOptional({ enum: AFFECTED_MODULES })
  @IsOptional()
  @IsIn(AFFECTED_MODULES)
  affectedModule?: PlanningAffectedModule;
}

export class UpdatePlanningMatterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ enum: PLANNING_MATTER_CATEGORIES })
  @IsOptional()
  @IsIn(PLANNING_MATTER_CATEGORIES)
  category?: PlanningMatterCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerEmployeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  partnerAttention?: boolean;

  @ApiPropertyOptional({ enum: AFFECTED_MODULES })
  @IsOptional()
  @IsIn(AFFECTED_MODULES)
  affectedModule?: PlanningAffectedModule;

  @ApiPropertyOptional({ enum: PLANNING_MATTER_STATUSES })
  @IsOptional()
  @IsIn(PLANNING_MATTER_STATUSES)
  status?: PlanningMatterStatus;

  @ApiPropertyOptional({ description: 'Required when resolving.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  resolution?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}
