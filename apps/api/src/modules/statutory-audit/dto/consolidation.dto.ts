import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  ASSESSMENT_ANSWERS,
  CONSOLIDATION_CONCLUSIONS,
  CONSOLIDATION_PROFESSIONAL_ACTIONS,
  CONVERSION_STATUS,
  LOCAL_FRAMEWORKS,
  MEMBER_OBJECTION_STATUS,
  PERIMETER_INCLUSION,
  POLICY_ALIGNMENTS,
  RELATIONSHIP_KINDS,
  type AssessmentAnswer,
  type ConsolidationOutcome,
  type ConsolidationProfessionalAction,
  type ConversionStatus,
  type LocalFramework,
  type MemberObjectionStatus,
  type PerimeterInclusion,
  type PolicyAlignment,
  type RelationshipKind,
} from '@hsdg/contracts';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const INCLUSIONS = Object.values(PERIMETER_INCLUSION);
const OBJECTION_STATUSES = Object.values(MEMBER_OBJECTION_STATUS);
/** A team-settable conversion status (withdrawn is the system's when a component aligns / leaves). */
const CONVERSION_STATUSES_SETTABLE = [
  CONVERSION_STATUS.open,
  CONVERSION_STATUS.inReview,
  CONVERSION_STATUS.completed,
];

/** A nullable percentage 0–100. */
function Pct(): PropertyDecorator {
  return (target, key) => {
    IsOptional()(target, key);
    ValidateIf((_, v) => v !== null)(target, key);
    IsNumber()(target, key);
    Min(0)(target, key);
    Max(100)(target, key);
  };
}

/** A nullable trimmed text field. */
function Text(max = 2000): PropertyDecorator {
  return (target, key) => {
    IsOptional()(target, key);
    ValidateIf((_, v) => v !== null)(target, key);
    IsString()(target, key);
    MaxLength(max)(target, key);
  };
}

/** A nullable YYYY-MM-DD date. */
function IsoDate(): PropertyDecorator {
  return (target, key) => {
    IsOptional()(target, key);
    ValidateIf((_, v) => v !== null)(target, key);
    Matches(ISO_DATE, { message: `${String(key)} must be YYYY-MM-DD` })(target, key);
  };
}

/** A nullable boolean. */
function NullableBool(): PropertyDecorator {
  return (target, key) => {
    IsOptional()(target, key);
    ValidateIf((_, v) => v !== null)(target, key);
    IsBoolean()(target, key);
  };
}

/** A nullable value from a list. */
function NullableIn(values: readonly string[]): PropertyDecorator {
  return (target, key) => {
    IsOptional()(target, key);
    ValidateIf((_, v) => v !== null)(target, key);
    IsIn(values as string[])(target, key);
  };
}

/** One related entity in the relationship assessment / perimeter (spec §5, §8, §10, §11). */
export class InvesteeDto {
  @ApiPropertyOptional({ description: 'Stable component id (kept across edits and years).' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  id?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ enum: RELATIONSHIP_KINDS, nullable: true })
  @NullableIn(RELATIONSHIP_KINDS)
  suggestedRelationship?: RelationshipKind | null;

  @ApiPropertyOptional({ nullable: true, description: 'Total ownership interest %.' })
  @Pct()
  ownershipPercent?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Pct()
  ownershipDirect?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Pct()
  ownershipIndirect?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Pct()
  votingDirect?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Pct()
  votingIndirect?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Controls the board composition.' })
  @NullableBool()
  boardCompositionControl?: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  @Text()
  boardRightsDetails?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Agreement key terms.' })
  @Text()
  contractualRights?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Legacy control judgment; superseded by controlConclusion.',
  })
  @NullableBool()
  hasControl?: boolean | null;

  @ApiPropertyOptional({ enum: ASSESSMENT_ANSWERS, nullable: true })
  @NullableIn(ASSESSMENT_ANSWERS)
  controlConclusion?: AssessmentAnswer | null;

  @ApiPropertyOptional({
    description: 'Legacy joint-arrangement flag; superseded by jointControl.',
  })
  @IsOptional()
  @IsBoolean()
  isJointArrangement?: boolean;

  @ApiPropertyOptional({ description: 'A joint operation (line-by-line), not a joint venture.' })
  @IsOptional()
  @IsBoolean()
  jointArrangementIsOperation?: boolean;

  @ApiPropertyOptional({ enum: ASSESSMENT_ANSWERS, nullable: true })
  @NullableIn(ASSESSMENT_ANSWERS)
  jointControl?: AssessmentAnswer | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Legacy 20% rebuttal; superseded by significantInfluence.',
  })
  @NullableBool()
  significantInfluenceRebutted?: boolean | null;

  @ApiPropertyOptional({ enum: ASSESSMENT_ANSWERS, nullable: true })
  @NullableIn(ASSESSMENT_ANSWERS)
  significantInfluence?: AssessmentAnswer | null;

  @ApiPropertyOptional({ description: 'Legacy indicator — Track B’s auditor matrix owns this.' })
  @IsOptional()
  @IsBoolean()
  auditedByOtherAuditor?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsoDate()
  effectiveFrom?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsoDate()
  effectiveTo?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'ISO country code / name.' })
  @Text(80)
  country?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @NullableBool()
  isIndianCompany?: boolean | null;

  @ApiPropertyOptional({ enum: INCLUSIONS, nullable: true, description: 'null = system proposal.' })
  @NullableIn(INCLUSIONS)
  included?: PerimeterInclusion | null;

  @ApiPropertyOptional({ nullable: true })
  @Text()
  inclusionReason?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsoDate()
  reportingDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Text()
  reportingDateReason?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Text()
  interimInformation?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Text()
  interveningTransactions?: string | null;

  @ApiPropertyOptional({ enum: LOCAL_FRAMEWORKS, nullable: true })
  @NullableIn(LOCAL_FRAMEWORKS)
  localFramework?: LocalFramework | null;

  @ApiPropertyOptional({ enum: POLICY_ALIGNMENTS, nullable: true })
  @NullableIn(POLICY_ALIGNMENTS)
  policyAlignment?: PolicyAlignment | null;

  @ApiPropertyOptional({ nullable: true })
  @Text(4000)
  notes?: string | null;
}

/** Rule 6 evidence (spec §7). */
export class Rule6EvidenceDto {
  @ApiPropertyOptional({ nullable: true })
  @NullableBool()
  otherMembersIntimatedInWriting?: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  @IsoDate()
  intimationDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @NullableBool()
  proofOfDeliveryRetained?: boolean | null;

  @ApiPropertyOptional({ enum: OBJECTION_STATUSES, nullable: true })
  @NullableIn(OBJECTION_STATUSES)
  objectionStatus?: MemberObjectionStatus | null;

  @ApiPropertyOptional({ nullable: true })
  @Text(200)
  parentName?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'SRN of the parent’s CFS filing (AOC-4 CFS).',
  })
  @Text(60)
  parentFilingSrn?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsoDate()
  parentFilingDate?: string | null;
}

/** Capture the 02.6-specific facts. */
export class SetConsolidationFactsDto {
  @ApiPropertyOptional({
    type: [InvesteeDto],
    description: 'Replaces the whole relationship assessment / perimeter.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvesteeDto)
  investees?: InvesteeDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isWhollyOwnedSubsidiary?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPartiallyOwnedSubsidiary?: boolean;

  @ApiPropertyOptional({
    description:
      'Legacy: all other members intimated and no objection (superseded by rule6Evidence).',
  })
  @IsOptional()
  @IsBoolean()
  otherMembersIntimatedNoObjection?: boolean;

  @ApiPropertyOptional({ description: 'Securities listed or in the process of listing.' })
  @IsOptional()
  @IsBoolean()
  securitiesListedOrInProcess?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'An intermediate/ultimate parent files compliant CFS (null = unknown).',
  })
  @NullableBool()
  parentFilesCompliantCfs?: boolean | null;

  @ApiPropertyOptional({ description: 'The master shows branches (BR-01 suggestion).' })
  @IsOptional()
  @IsBoolean()
  hasBranches?: boolean;

  @ApiPropertyOptional({ type: Rule6EvidenceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => Rule6EvidenceDto)
  rule6Evidence?: Rule6EvidenceDto;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(1)
  version!: number;
}

/** CFS-05: Confirm / Override / Information Pending (spec §22). */
export class RecordConsolidationDecisionDto {
  @ApiPropertyOptional({
    enum: CONSOLIDATION_PROFESSIONAL_ACTIONS,
    description: 'Omitted = confirm when the conclusion matches the suggestion, else override.',
  })
  @IsOptional()
  @IsIn(CONSOLIDATION_PROFESSIONAL_ACTIONS)
  action?: ConsolidationProfessionalAction;

  @ApiPropertyOptional({ enum: CONSOLIDATION_CONCLUSIONS })
  @IsOptional()
  @IsIn(CONSOLIDATION_CONCLUSIONS)
  conclusion?: ConsolidationOutcome;

  @ApiPropertyOptional({ description: 'Override reason (mandatory on override).' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  basis?: string;

  @ApiPropertyOptional({ description: 'Technical basis (mandatory on override).' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  technicalBasis?: string;

  @ApiPropertyOptional({
    description: 'Supporting evidence note (or link a file to 02.6) — mandatory on override.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  supportingEvidence?: string;

  @ApiPropertyOptional({ description: 'Information Pending: the blocking fact(s).' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  pendingReason?: string;

  @ApiPropertyOptional({ description: 'Downstream impact note.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  impact?: string;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(1)
  version!: number;
}

/** CFS-05 Engagement Partner approval. */
export class PartnerApproveConsolidationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

/** One GAAP / policy difference on a conversion work item. */
export class ConversionDifferenceDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  area!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Journal / workpaper reference.' })
  @Text(200)
  adjustmentReference?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  amount?: number | null;
}

/** Update a CFS-04 conversion work item. */
export class UpdateConsolidationConversionDto {
  @ApiPropertyOptional({ enum: CONVERSION_STATUSES_SETTABLE })
  @IsOptional()
  @IsIn(CONVERSION_STATUSES_SETTABLE)
  status?: ConversionStatus;

  @ApiPropertyOptional({ type: [ConversionDifferenceDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConversionDifferenceDto)
  differences?: ConversionDifferenceDto[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  reviewerEmployeeId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Component reporting package (SharePoint).' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  reportingPackageDocumentId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Final adjusted group TB (SharePoint).' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  adjustedTbDocumentId?: string | null;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}
