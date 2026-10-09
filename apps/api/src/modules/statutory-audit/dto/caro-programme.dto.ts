import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  CARO_CLAUSE_CONCLUSIONS,
  CARO_COMPONENT_APPLICABLE,
  CARO_FINDING_SEVERITIES,
  CARO_RELEVANCES,
  CARO_REVIEW_ACTIONS,
  type AddCaroComponentInput,
  type CaroClauseConclusion,
  type CaroClauseReviewInput,
  type CaroComponentApplicable,
  type CaroFindingSeverity,
  type CaroRelevance,
  type CaroReviewAction,
  type CreateCaroFindingInput,
  type LinkCaroClauseEvidenceInput,
  type UpdateCaroClauseInput,
  type UpdateCaroComponentInput,
  type UpdateCaroFindingInput,
} from '@hsdg/contracts';

/** Clause work — relevance, work, management response, draft reporting, conclusion (§13). */
export class UpdateCaroClauseDto implements UpdateCaroClauseInput {
  @ApiPropertyOptional({ enum: CARO_RELEVANCES })
  @IsOptional()
  @IsIn(CARO_RELEVANCES)
  relevance?: CaroRelevance;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  relevanceReason?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  workPerformed?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  managementResponse?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Proposed reporting language (draft).' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  draftReporting?: string | null;

  @ApiPropertyOptional({ enum: CARO_CLAUSE_CONCLUSIONS, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn(CARO_CLAUSE_CONCLUSIONS)
  conclusion?: CaroClauseConclusion | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  conclusionNote?: string | null;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

export class CaroClauseReviewDto implements CaroClauseReviewInput {
  @ApiProperty({ enum: CARO_REVIEW_ACTIONS })
  @IsIn(CARO_REVIEW_ACTIONS)
  action!: CaroReviewAction;

  @ApiPropertyOptional({ nullable: true, description: 'Required when returning.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string | null;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

export class LinkCaroClauseEvidenceDto implements LinkCaroClauseEvidenceInput {
  @ApiPropertyOptional({ description: 'An engagement document.' })
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional({ description: 'A Section 06 evidence record.' })
  @IsOptional()
  @IsUUID()
  auditEvidenceId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class CreateCaroFindingDto implements CreateCaroFindingInput {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  description!: string;

  @ApiPropertyOptional({ enum: CARO_FINDING_SEVERITIES })
  @IsOptional()
  @IsIn(CARO_FINDING_SEVERITIES)
  severity?: CaroFindingSeverity;

  @ApiPropertyOptional({ nullable: true, description: 'Section 06 work area key.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  workAreaKey?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  procedureId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber()
  amount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  includeInReport?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  managementResponse?: string | null;
}

export class UpdateCaroFindingDto implements UpdateCaroFindingInput {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ enum: CARO_FINDING_SEVERITIES })
  @IsOptional()
  @IsIn(CARO_FINDING_SEVERITIES)
  severity?: CaroFindingSeverity;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  workAreaKey?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  procedureId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber()
  amount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  includeInReport?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  managementResponse?: string | null;

  @ApiPropertyOptional({ enum: ['open', 'resolved'] })
  @IsOptional()
  @IsIn(['open', 'resolved'])
  status?: 'open' | 'resolved';

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  resolution?: string | null;

  @ApiPropertyOptional({ description: 'Withdraw (kept on the trail, never deleted).' })
  @IsOptional()
  @IsBoolean()
  withdrawn?: boolean;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

export class AddCaroComponentDto implements AddCaroComponentInput {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  componentName!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  relationship?: string | null;
}

export class UpdateCaroComponentDto implements UpdateCaroComponentInput {
  @ApiPropertyOptional({ enum: CARO_COMPONENT_APPLICABLE })
  @IsOptional()
  @IsIn(CARO_COMPONENT_APPLICABLE)
  caroApplicable?: CaroComponentApplicable;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  auditorName?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: "The component auditor's report (engagement document).",
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  auditorReportDocumentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsBoolean()
  qualificationIdentified?: boolean | null;

  @ApiPropertyOptional({ nullable: true, description: 'CARO paragraph numbers of the remarks.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  paragraphRefs?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  remarks?: string | null;

  @ApiPropertyOptional({ description: 'Withdraw (kept on the trail, never deleted).' })
  @IsOptional()
  @IsBoolean()
  withdrawn?: boolean;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}
