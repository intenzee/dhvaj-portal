import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  ICFR_COMPONENT_AUDITORS,
  ICFR_COMPONENT_ICFR,
  ICFR_COMPONENT_MATERIALITY,
  ICFR_CONTROL_FREQUENCIES,
  ICFR_CONTROL_NATURES,
  ICFR_DEFICIENCY_CLASSES,
  ICFR_DESIGN,
  ICFR_FOLLOWUP_STATUSES,
  ICFR_IMPLEMENTATION,
  ICFR_LIKELIHOODS,
  ICFR_MAGNITUDES,
  ICFR_OPERATING,
  ICFR_PARENT_CONCLUSIONS,
  ICFR_REMEDIATION_STATUSES,
  ICFR_REPORTING_IMPACTS,
  ICFR_SCOPINGS,
  ICFR_WORKSTREAM_CONCLUSIONS,
  RISK_ASSERTION,
  type AddIcfrComponentInput,
  type AddIcfrProcessAreaInput,
  type ConcludeIcfrConsolidatedInput,
  type ConcludeIcfrWorkstreamInput,
  type CreateIcfrControlInput,
  type CreateIcfrDeficiencyInput,
  type IcfrComponentAuditor,
  type IcfrComponentIcfr,
  type IcfrComponentMateriality,
  type IcfrControlFrequency,
  type IcfrControlNature,
  type IcfrDeficiencyClass,
  type IcfrDesign,
  type IcfrFollowUpStatus,
  type IcfrImplementation,
  type IcfrLikelihood,
  type IcfrMagnitude,
  type IcfrOperating,
  type IcfrParentConclusion,
  type IcfrRemediationStatus,
  type IcfrReportingImpact,
  type IcfrScoping,
  type IcfrWorkstreamConclusion,
  type LinkIcfrControlEvidenceInput,
  type ReviewIcfrControlInput,
  type ReviewIcfrDeficiencyInput,
  type RiskAssertion,
  type UpdateIcfrComponentInput,
  type UpdateIcfrControlInput,
  type UpdateIcfrDeficiencyInput,
  type UpdateIcfrFollowUpInput,
  type UpdateIcfrProcessAreaInput,
} from '@hsdg/contracts';

const ASSERTIONS = Object.values(RISK_ASSERTION);
const DESIGNS = Object.values(ICFR_DESIGN);
const IMPLEMENTATIONS = Object.values(ICFR_IMPLEMENTATION);
const OPERATING = Object.values(ICFR_OPERATING);
const nullable = () => ValidateIf((_o, v) => v !== null);

class Versioned {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

// ── Process areas ────────────────────────────────────────────────────────────

export class UpdateIcfrProcessAreaDto extends Versioned implements UpdateIcfrProcessAreaInput {
  @ApiProperty({ enum: ICFR_SCOPINGS })
  @IsIn(ICFR_SCOPINGS)
  scoping!: IcfrScoping;

  @ApiPropertyOptional({ nullable: true, description: 'Required for Not in scope.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  scopingReason?: string | null;
}

export class AddIcfrProcessAreaDto implements AddIcfrProcessAreaInput {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiProperty({ description: 'Why risk / scoping makes the process significant.' })
  @IsString()
  @MaxLength(2000)
  scopingReason!: string;
}

// ── Controls ─────────────────────────────────────────────────────────────────

class ControlFields {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @nullable()
  @IsUUID()
  processAreaId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  controlRef?: string | null;

  @ApiPropertyOptional({ type: [String], enum: ASSERTIONS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(9)
  @IsIn(ASSERTIONS, { each: true })
  assertions?: RiskAssertion[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @nullable()
  @IsUUID()
  relatedRiskId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  relatedRisk?: string | null;

  @ApiPropertyOptional({ enum: ICFR_CONTROL_NATURES, nullable: true })
  @IsOptional()
  @nullable()
  @IsIn(ICFR_CONTROL_NATURES)
  nature?: IcfrControlNature | null;

  @ApiPropertyOptional({ enum: ICFR_CONTROL_FREQUENCIES, nullable: true })
  @IsOptional()
  @nullable()
  @IsIn(ICFR_CONTROL_FREQUENCIES)
  frequency?: IcfrControlFrequency | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isKey?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  owner?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @nullable()
  @IsUUID()
  procedureId?: string | null;
}

export class CreateIcfrControlDto extends ControlFields implements CreateIcfrControlInput {
  @ApiPropertyOptional({ nullable: true, description: 'Defaults to the process area title.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  process?: string | null;

  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  description!: string;

  @ApiProperty()
  @IsBoolean()
  purposeFsAudit!: boolean;

  @ApiProperty()
  @IsBoolean()
  purposeIcfr!: boolean;
}

export class UpdateIcfrControlDto extends ControlFields implements UpdateIcfrControlInput {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  process?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  purposeFsAudit?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  purposeIcfr?: boolean;

  @ApiPropertyOptional({ enum: DESIGNS, nullable: true })
  @IsOptional()
  @nullable()
  @IsIn(DESIGNS)
  design?: IcfrDesign | null;

  @ApiPropertyOptional({ enum: IMPLEMENTATIONS, nullable: true })
  @IsOptional()
  @nullable()
  @IsIn(IMPLEMENTATIONS)
  implementation?: IcfrImplementation | null;

  @ApiPropertyOptional({ enum: OPERATING, nullable: true })
  @IsOptional()
  @nullable()
  @IsIn(OPERATING)
  operatingEffectiveness?: IcfrOperating | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  testNote?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  withdrawn?: boolean;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

export class ReviewIcfrControlDto extends Versioned implements ReviewIcfrControlInput {
  @ApiProperty({ enum: ['submit', 'return', 'review', 'reopen'] })
  @IsIn(['submit', 'return', 'review', 'reopen'])
  action!: ReviewIcfrControlInput['action'];

  @ApiPropertyOptional({ nullable: true, description: 'Required when returning.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string | null;
}

export class LinkIcfrControlEvidenceDto implements LinkIcfrControlEvidenceInput {
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

// ── Deficiencies ─────────────────────────────────────────────────────────────

class DeficiencyFields {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @nullable()
  @IsUUID()
  controlId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @nullable()
  @IsUUID()
  processAreaId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  workAreaKey?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  affectedAccount?: string | null;

  @ApiPropertyOptional({ type: [String], enum: ASSERTIONS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(9)
  @IsIn(ASSERTIONS, { each: true })
  assertions?: RiskAssertion[];

  @ApiPropertyOptional({ enum: ICFR_MAGNITUDES, nullable: true })
  @IsOptional()
  @nullable()
  @IsIn(ICFR_MAGNITUDES)
  magnitude?: IcfrMagnitude | null;

  @ApiPropertyOptional({ enum: ICFR_LIKELIHOODS, nullable: true })
  @IsOptional()
  @nullable()
  @IsIn(ICFR_LIKELIHOODS)
  likelihood?: IcfrLikelihood | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  compensatingControlIds?: string[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  compensatingNote?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  remediationAction?: string | null;

  @ApiPropertyOptional({ enum: ICFR_REMEDIATION_STATUSES })
  @IsOptional()
  @IsIn(ICFR_REMEDIATION_STATUSES)
  remediationStatus?: IcfrRemediationStatus;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  auditImpact?: string | null;

  @ApiPropertyOptional({ enum: ICFR_REPORTING_IMPACTS, nullable: true })
  @IsOptional()
  @nullable()
  @IsIn(ICFR_REPORTING_IMPACTS)
  reportingImpact?: IcfrReportingImpact | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  reportingNote?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @nullable()
  @IsUUID()
  followUpId?: string | null;
}

export class CreateIcfrDeficiencyDto extends DeficiencyFields implements CreateIcfrDeficiencyInput {
  @ApiProperty({ enum: ICFR_DEFICIENCY_CLASSES })
  @IsIn(ICFR_DEFICIENCY_CLASSES)
  classification!: IcfrDeficiencyClass;

  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  description!: string;
}

export class UpdateIcfrDeficiencyDto extends DeficiencyFields implements UpdateIcfrDeficiencyInput {
  @ApiPropertyOptional({ enum: ICFR_DEFICIENCY_CLASSES })
  @IsOptional()
  @IsIn(ICFR_DEFICIENCY_CLASSES)
  classification?: IcfrDeficiencyClass;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ enum: ['open', 'closed'] })
  @IsOptional()
  @IsIn(['open', 'closed'])
  status?: 'open' | 'closed';

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  withdrawn?: boolean;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

export class ReviewIcfrDeficiencyDto extends Versioned implements ReviewIcfrDeficiencyInput {
  @ApiProperty({ enum: ['manager_review', 'partner_conclude', 'reopen'] })
  @IsIn(['manager_review', 'partner_conclude', 'reopen'])
  action!: ReviewIcfrDeficiencyInput['action'];

  @ApiPropertyOptional({ nullable: true, description: 'Required for partner_conclude.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  partnerConclusion?: string | null;
}

export class UpdateIcfrFollowUpDto extends Versioned implements UpdateIcfrFollowUpInput {
  @ApiProperty({ enum: ICFR_FOLLOWUP_STATUSES })
  @IsIn(ICFR_FOLLOWUP_STATUSES)
  status!: IcfrFollowUpStatus;

  @ApiPropertyOptional({ nullable: true, description: 'Required unless the follow-up is open.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  conclusionNote?: string | null;
}

export class ConcludeIcfrWorkstreamDto extends Versioned implements ConcludeIcfrWorkstreamInput {
  @ApiProperty({ enum: ICFR_WORKSTREAM_CONCLUSIONS, nullable: true, description: 'null reopens.' })
  @nullable()
  @IsIn(ICFR_WORKSTREAM_CONCLUSIONS)
  conclusion!: IcfrWorkstreamConclusion | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  note?: string | null;
}

// ── Consolidated ─────────────────────────────────────────────────────────────

export class AddIcfrComponentDto implements AddIcfrComponentInput {
  @ApiProperty()
  @IsString()
  @MaxLength(300)
  componentName!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  relationship?: string | null;
}

export class UpdateIcfrComponentDto extends Versioned implements UpdateIcfrComponentInput {
  @ApiPropertyOptional({ enum: ['yes', 'no'], nullable: true })
  @IsOptional()
  @nullable()
  @IsIn(['yes', 'no'])
  indianCompany?: 'yes' | 'no' | null;

  @ApiPropertyOptional({ enum: ICFR_COMPONENT_ICFR })
  @IsOptional()
  @IsIn(ICFR_COMPONENT_ICFR)
  componentIcfr?: IcfrComponentIcfr;

  @ApiPropertyOptional({ enum: ICFR_COMPONENT_AUDITORS, nullable: true })
  @IsOptional()
  @nullable()
  @IsIn(ICFR_COMPONENT_AUDITORS)
  auditor?: IcfrComponentAuditor | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  auditorName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @nullable()
  @IsUUID()
  reportDocumentId?: string | null;

  @ApiPropertyOptional({ enum: ICFR_COMPONENT_MATERIALITY, nullable: true })
  @IsOptional()
  @nullable()
  @IsIn(ICFR_COMPONENT_MATERIALITY)
  materiality?: IcfrComponentMateriality | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  materialityNote?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @nullable()
  @IsBoolean()
  materialWeakness?: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  materialWeaknessDetails?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  withdrawn?: boolean;
}

export class ConcludeIcfrConsolidatedDto
  extends Versioned
  implements ConcludeIcfrConsolidatedInput
{
  @ApiProperty({ enum: ICFR_PARENT_CONCLUSIONS, nullable: true, description: 'null reopens.' })
  @nullable()
  @IsIn(ICFR_PARENT_CONCLUSIONS)
  parentConclusion!: IcfrParentConclusion | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  note?: string | null;
}
