import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBase64,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PLANNING_AFFECTED_MODULES,
  PLANNING_ATTENTIONS,
  PLANNING_EVIDENCE_TARGETS,
  PLANNING_MATTER_CATEGORIES,
  type PlanningAffectedModule,
  type PlanningAttention,
  type PlanningEvidenceTarget,
  type PlanningMatterCategory,
} from '@hsdg/contracts';

const AFFECTED_MODULES = [...PLANNING_AFFECTED_MODULES];

/** Reopen 03.1 after Planning approval (§19 controlled revision). */
export class ReopenPlanningIntelligenceDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;
}

export class AcknowledgePartnerAttentionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

export class ChallengePartnerAttentionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  challenge!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

export class RespondPartnerAttentionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  response!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

export class FlagPartnerAttentionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  signalId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  focusId?: string | null;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  note!: string;
}

export class PlanningEvidenceQueryDto {
  @ApiProperty({ enum: PLANNING_EVIDENCE_TARGETS })
  @IsIn(PLANNING_EVIDENCE_TARGETS)
  targetType!: PlanningEvidenceTarget;

  @ApiProperty()
  @IsUUID()
  targetId!: string;
}

export class LinkPlanningEvidenceDto extends PlanningEvidenceQueryDto {
  @ApiProperty({ description: 'An engagement document — linked, never copied.' })
  @IsUUID()
  documentId!: string;
}

export class AddPlanningEvidenceDto extends PlanningEvidenceQueryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  filename!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contentType?: string;

  @ApiProperty({ description: 'File bytes, base64-encoded.' })
  @IsBase64()
  contentBase64!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;
}

/** 03.1.8 — an action agreed in the team discussion (owner + due date). */
export class CreateDiscussionActionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title!: string;

  @ApiProperty()
  @IsUUID()
  ownerEmployeeId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  dueDate?: string | null;

  @ApiPropertyOptional({ enum: PLANNING_MATTER_CATEGORIES })
  @IsOptional()
  @IsIn(PLANNING_MATTER_CATEGORIES)
  category?: PlanningMatterCategory;

  @ApiPropertyOptional({ enum: AFFECTED_MODULES })
  @IsOptional()
  @IsIn(AFFECTED_MODULES)
  affectedModule?: PlanningAffectedModule | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  partnerAttention?: boolean;
}

/** 03.1.8 — "Create Planning Signal" from inside the discussion. */
export class CreateDiscussionSignalDto {
  @ApiProperty({ description: 'Factual statement only — not a risk conclusion.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  observation!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  whyMayMatter?: string | null;

  @ApiPropertyOptional({ enum: PLANNING_ATTENTIONS })
  @IsOptional()
  @IsIn(PLANNING_ATTENTIONS)
  suggestedAttention?: PlanningAttention;
}
