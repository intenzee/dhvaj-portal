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
  AREA_OF_FOCUS_STATUSES,
  AUDIT_ORIENTATIONS,
  PLANNING_ATTENTIONS,
  PLANNING_CHANGE_CATEGORIES,
  PLANNING_CHANGE_FR_IMPACTS,
  PLANNING_DESTINATIONS,
  PLANNING_INTELLIGENCE_STATUSES,
  PLANNING_SIGNAL_ASSESSMENTS,
  PLANNING_SIGNAL_MANUAL_SOURCES,
  PLANNING_SIGNAL_STATUSES,
  type AreaOfFocusStatus,
  type AuditOrientation,
  type PlanningAttention,
  type PlanningChangeCategory,
  type PlanningChangeFrImpact,
  type PlanningDestination,
  type PlanningIntelligenceStatus,
  type PlanningSignalAssessment,
  type PlanningSignalSource,
  type PlanningSignalStatus,
} from '@hsdg/contracts';

/** Raise a Planning Signal by hand (03.1 §7 — Manager / Partner / prior year). */
export class CreatePlanningSignalDto {
  @ApiProperty({ enum: PLANNING_SIGNAL_MANUAL_SOURCES })
  @IsIn(PLANNING_SIGNAL_MANUAL_SOURCES)
  source!: PlanningSignalSource;

  @ApiProperty({ description: 'Factual statement only — not a risk conclusion.' })
  @IsString()
  @MaxLength(2000)
  observation!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  whyMayMatter?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  potentialImplications?: string;

  @ApiPropertyOptional({ enum: PLANNING_ATTENTIONS })
  @IsOptional()
  @IsIn(PLANNING_ATTENTIONS)
  suggestedAttention?: PlanningAttention;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceLink?: string;

  @ApiPropertyOptional({ description: 'Link an existing document as evidence (never a copy).' })
  @IsOptional()
  @IsUUID()
  documentId?: string;
}

/** Assess a Planning Signal in place (03.1 §9). Optimistic-locked. */
export class AssessPlanningSignalDto {
  @ApiPropertyOptional({ enum: PLANNING_ATTENTIONS })
  @IsOptional()
  @IsIn(PLANNING_ATTENTIONS)
  attention?: PlanningAttention;

  @ApiPropertyOptional({
    description: 'Required when downgrading a system-suggested Immediate Partner Attention.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  attentionRationale?: string;

  @ApiPropertyOptional({ enum: PLANNING_SIGNAL_ASSESSMENTS })
  @IsOptional()
  @IsIn(PLANNING_SIGNAL_ASSESSMENTS)
  managerAssessment?: PlanningSignalAssessment;

  @ApiPropertyOptional({ description: 'Required for Not Relevant.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  assessmentRationale?: string;

  @ApiPropertyOptional({ description: 'Owner (employee id) — required for further information.' })
  @IsOptional()
  @IsUUID()
  ownerEmployeeId?: string;

  @ApiPropertyOptional({ enum: PLANNING_DESTINATIONS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(PLANNING_DESTINATIONS, { each: true })
  destinations?: PlanningDestination[];

  @ApiPropertyOptional({ enum: PLANNING_SIGNAL_STATUSES })
  @IsOptional()
  @IsIn(PLANNING_SIGNAL_STATUSES)
  status?: PlanningSignalStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(1)
  version!: number;
}

/** Create an Area of Focus grouping one or more signals (03.1 §11). */
export class CreateAreaOfFocusDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  whyRequiresAttention?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  potentialFsAreas?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  expectedStrategicImplication?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  partnerAttention?: boolean;

  @ApiPropertyOptional({ enum: PLANNING_DESTINATIONS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(PLANNING_DESTINATIONS, { each: true })
  destinations?: PlanningDestination[];

  @ApiPropertyOptional({ type: [String], description: 'Planning Signal ids to group.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  signalIds?: string[];
}

/** Update an Area of Focus. `signalIds`, when present, replaces the linked set. */
export class UpdateAreaOfFocusDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  whyRequiresAttention?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  potentialFsAreas?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  expectedStrategicImplication?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  partnerAttention?: boolean;

  @ApiPropertyOptional({ enum: PLANNING_DESTINATIONS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(PLANNING_DESTINATIONS, { each: true })
  destinations?: PlanningDestination[];

  @ApiPropertyOptional({ enum: AREA_OF_FOCUS_STATUSES })
  @IsOptional()
  @IsIn(AREA_OF_FOCUS_STATUSES)
  status?: AreaOfFocusStatus;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  signalIds?: string[];

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

/** Record a significant current-year change (03.1.2, PI-01). */
export class CreatePlanningChangeDto {
  @ApiProperty({ enum: PLANNING_CHANGE_CATEGORIES })
  @IsIn(PLANNING_CHANGE_CATEGORIES)
  category!: PlanningChangeCategory;

  @ApiPropertyOptional({ description: 'What changed.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ description: 'Effective date (ISO-8601 date).' })
  @IsOptional()
  @IsISO8601()
  effectiveDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  sourceEvidence?: string;

  @ApiPropertyOptional({ enum: PLANNING_CHANGE_FR_IMPACTS })
  @IsOptional()
  @IsIn(PLANNING_CHANGE_FR_IMPACTS)
  frImpactKnown?: PlanningChangeFrImpact;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional({ description: 'Generate a linked Planning Signal.' })
  @IsOptional()
  @IsBoolean()
  createSignal?: boolean;
}

export class UpdatePlanningChangeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  effectiveDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  sourceEvidence?: string;

  @ApiPropertyOptional({ enum: PLANNING_CHANGE_FR_IMPACTS })
  @IsOptional()
  @IsIn(PLANNING_CHANGE_FR_IMPACTS)
  frImpactKnown?: PlanningChangeFrImpact;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  createSignal?: boolean;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

/** Update the 03.1 record — AS-01 orientation, AS-02 scope, strategy summary, status. */
export class UpdatePlanningIntelligenceDto {
  @ApiPropertyOptional({ enum: PLANNING_INTELLIGENCE_STATUSES })
  @IsOptional()
  @IsIn(PLANNING_INTELLIGENCE_STATUSES)
  status?: PlanningIntelligenceStatus;

  @ApiPropertyOptional({ enum: AUDIT_ORIENTATIONS })
  @IsOptional()
  @IsIn(AUDIT_ORIENTATIONS)
  orientation?: AuditOrientation;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  orientationNote?: string;

  @ApiPropertyOptional({ description: 'AS-02 additional scope consideration.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  additionalScope?: string;

  @ApiPropertyOptional({ description: 'AS-02 answer: false = No, true = Yes (describe it).' })
  @IsOptional()
  @IsBoolean()
  additionalScopeRequired?: boolean;

  @ApiPropertyOptional({ description: 'Continuing audit: prior-year matters reviewed (§14).' })
  @IsOptional()
  @IsBoolean()
  priorYearReviewed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  strategySummary?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}
