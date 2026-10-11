import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  AUDIT_TRAIL_CONCLUSION,
  IEPF_STATUS,
  MANAGERIAL_CATEGORIES,
  OTHER_REPORTING_ACTIONS,
  OTHER_REPORTING_CONCLUSIONS,
  REPORTING_STATUSES,
  REPORTING_WORK_STATUSES,
  RULE11E_CONCLUSION,
  SOFTWARE_MODULES,
  TRIS,
  type AuditTrailConclusion,
  type IepfStatus,
  type ManagerialCategory,
  type OtherReportingAction,
  type OtherReportingOutcome,
  type ReportingStatus,
  type ReportingWorkStatus,
  type Rule11eConclusion,
  type SoftwareModule,
  type Tri,
} from '@hsdg/contracts';

/** A nullable free-text field. */
function Text(max = 4000): PropertyDecorator {
  return (target, key) => {
    IsOptional()(target, key);
    ValidateIf((_, v) => v !== null)(target, key);
    IsString()(target, key);
    MaxLength(max)(target, key);
  };
}

/** A nullable ₹ / count amount >= 0. */
function Amount(): PropertyDecorator {
  return (target, key) => {
    IsOptional()(target, key);
    ValidateIf((_, v) => v !== null)(target, key);
    IsNumber()(target, key);
    Min(0)(target, key);
  };
}

function OneOf(values: readonly string[]): PropertyDecorator {
  return (target, key) => {
    IsOptional()(target, key);
    IsIn(values as string[])(target, key);
  };
}

function Bool(): PropertyDecorator {
  return (target, key) => {
    IsOptional()(target, key);
    IsBoolean()(target, key);
  };
}

/** One accounting software / module on the Rule 11(g) register (spec §11). */
export class SoftwareSystemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) id?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @ApiPropertyOptional() @Bool() hasAuditTrailFeature?: boolean;
  @ApiPropertyOptional() @Bool() auditTrailOperatedAllYear?: boolean;
  @ApiPropertyOptional({ enum: SOFTWARE_MODULES }) @OneOf(SOFTWARE_MODULES) module?: SoftwareModule;
  @ApiPropertyOptional({ nullable: true }) @Text(200) moduleOther?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Text(1000) booksAffected?: string | null;
  @ApiPropertyOptional()
  @OneOf(['available', 'not_available', 'pending'])
  featureStatus?: 'available' | 'not_available' | 'pending';
  @ApiPropertyOptional()
  @OneOf(['yes', 'no', 'exceptions', 'pending'])
  enabledThroughout?: 'yes' | 'no' | 'exceptions' | 'pending';
  @ApiPropertyOptional({ nullable: true }) @Text() enabledNote?: string | null;
  @ApiPropertyOptional()
  @OneOf(['complete', 'gaps', 'pending'])
  transactionsCovered?: 'complete' | 'gaps' | 'pending';
  @ApiPropertyOptional({ nullable: true }) @Text(1000) privilegedUsers?: string | null;
  @ApiPropertyOptional({ enum: TRIS }) @OneOf(TRIS) canAlterOrDisable?: Tri;
  @ApiPropertyOptional({ enum: TRIS }) @OneOf(TRIS) tampering?: Tri;
  @ApiPropertyOptional()
  @OneOf(['compliant', 'exception', 'pending'])
  preservation?: 'compliant' | 'exception' | 'pending';
  @ApiPropertyOptional({ nullable: true }) @Text() evidence?: string | null;
  @ApiPropertyOptional()
  @OneOf(Object.values(AUDIT_TRAIL_CONCLUSION))
  conclusion?: AuditTrailConclusion;
  @ApiPropertyOptional({ nullable: true }) @Text(500) icfrCrossRef?: string | null;
  @ApiPropertyOptional() @Bool() booksCrossRef?: boolean;
}

/** One managerial person on the Section 197 remuneration workpaper (spec §13). */
export class ManagerialPersonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) id?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @ApiPropertyOptional({ nullable: true }) @Text(20) din?: string | null;
  @ApiProperty({ enum: MANAGERIAL_CATEGORIES })
  @IsIn(MANAGERIAL_CATEGORIES)
  category!: ManagerialCategory;
  @ApiPropertyOptional({ nullable: true, description: 'Remuneration for the year (₹).' })
  @Amount()
  remuneration!: number | null;
  @ApiPropertyOptional({ nullable: true, description: 'Section 196(3) — age (years) at appointment.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  age?: number | null;
  @ApiPropertyOptional({ nullable: true, description: 'Section 196(2) — term of the appointment (years).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50)
  termYears?: number | null;
  @ApiPropertyOptional({ description: 'Section 196(3)(a) proviso — special resolution for 70+.' })
  @Bool()
  ageSpecialResolution?: boolean;
}

export class RemunerationApprovalsDto {
  @ApiPropertyOptional() @Bool() overallSpecialResolution?: boolean;
  @ApiPropertyOptional() @Bool() executiveSpecialResolution?: boolean;
  @ApiPropertyOptional() @Bool() nonExecutiveSpecialResolution?: boolean;
  @ApiPropertyOptional() @Bool() scheduleVSpecialResolution?: boolean;
  @ApiPropertyOptional({ nullable: true }) @Text() note?: string | null;
}

export class Rule11eAssessmentDto {
  @ApiPropertyOptional({ enum: TRIS }) @OneOf(TRIS) representationObtained?: Tri;
  @ApiPropertyOptional({ enum: TRIS }) @OneOf(TRIS) transactionsIdentified?: Tri;
  @ApiPropertyOptional({ nullable: true }) @Text() parties?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Text() beneficiaries?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Text() auditProcedures?: string | null;
  @ApiPropertyOptional({ enum: TRIS }) @OneOf(TRIS) contraryMatter?: Tri;
  @ApiPropertyOptional({ nullable: true }) @Text() contraryNote?: string | null;
  @ApiPropertyOptional() @OneOf(Object.values(RULE11E_CONCLUSION)) conclusion?: Rule11eConclusion;
}

export class LitigationFactsDto {
  @ApiPropertyOptional({ enum: TRIS }) @OneOf(TRIS) identified?: Tri;
  @ApiPropertyOptional({ nullable: true }) @Amount() totalMatters?: number | null;
  @ApiPropertyOptional({ nullable: true }) @Amount() materialMatters?: number | null;
  @ApiPropertyOptional()
  @OneOf(['disclosed', 'partially_disclosed', 'not_disclosed', 'pending'])
  disclosure?: 'disclosed' | 'partially_disclosed' | 'not_disclosed' | 'pending';
  @ApiPropertyOptional({ nullable: true }) @Amount() exceptions?: number | null;
  @ApiPropertyOptional({ nullable: true }) @Text(500) sourceWorkpaper?: string | null;
}

export class ForeseeableLossFactsDto {
  @ApiPropertyOptional({ enum: TRIS }) @OneOf(TRIS) hasLongTermContracts?: Tri;
  @ApiPropertyOptional({ enum: TRIS }) @OneOf(TRIS) hasDerivativeContracts?: Tri;
  @ApiPropertyOptional({ enum: TRIS }) @OneOf(TRIS) provisionAdequate?: Tri;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  linkedWorkpapers?: string[];
}

export class IepfFactsDto {
  @ApiPropertyOptional() @OneOf(Object.values(IEPF_STATUS)) status?: IepfStatus;
  @ApiPropertyOptional({ nullable: true }) @Amount() delayAmount?: number | null;
  @ApiPropertyOptional({ nullable: true }) @Text(200) delayPeriod?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Text(500) sourceWorkpaper?: string | null;
}

export class DividendFactsDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  declaredOrPaid?: boolean | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(['interim', 'final', 'both'])
  kind?: 'interim' | 'final' | 'both' | null;
  @ApiPropertyOptional({ enum: TRIS }) @OneOf(TRIS) section123Compliant?: Tri;
  @ApiPropertyOptional({ nullable: true }) @Text() note?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Text(500) sourceWorkpaper?: string | null;
}

/** Capture the 02.7 facts (spec §4–§13). Omitted = unchanged. */
export class SetOtherReportingFactsDto {
  @ApiPropertyOptional({ type: [SoftwareSystemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SoftwareSystemDto)
  softwareSystems?: SoftwareSystemDto[];

  @ApiPropertyOptional({ nullable: true, description: 'Managerial remuneration paid (₹).' })
  @Amount()
  managerialRemunerationPaid?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Section 198 net profit (₹; may be negative).',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  section198NetProfit?: number | null;

  @ApiPropertyOptional() @Bool() hasManagingOrWholeTimeDirector?: boolean;

  @ApiPropertyOptional({ type: [ManagerialPersonDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManagerialPersonDto)
  managerialPersons?: ManagerialPersonDto[];

  @ApiPropertyOptional({ type: RemunerationApprovalsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RemunerationApprovalsDto)
  approvals?: RemunerationApprovalsDto;

  @ApiPropertyOptional({ nullable: true, description: 'Effective capital (₹; may be negative).' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  effectiveCapital?: number | null;

  @ApiPropertyOptional() @Bool() inadequateProfits?: boolean;
  @ApiPropertyOptional() @Bool() fraudIdentified?: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Fraud amount (₹).' })
  @Amount()
  fraudAmount?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  fraudEventDate?: string | null;

  @ApiPropertyOptional() @Bool() intermediaryFundsAdvanced?: boolean;
  @ApiPropertyOptional() @Bool() ultimateBeneficiaryFundsReceived?: boolean;
  @ApiPropertyOptional() @Bool() fundingRepresentationsObtained?: boolean;

  @ApiPropertyOptional({ type: Rule11eAssessmentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => Rule11eAssessmentDto)
  rule11eAdvanced?: Rule11eAssessmentDto;

  @ApiPropertyOptional({ type: Rule11eAssessmentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => Rule11eAssessmentDto)
  rule11eReceived?: Rule11eAssessmentDto;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  dividendCompliesSec123?: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  pendingLitigationDisclosed?: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  foreseeableLossesProvided?: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  iepfTransferDelay?: boolean | null;

  @ApiPropertyOptional({ type: LitigationFactsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LitigationFactsDto)
  litigation?: LitigationFactsDto;

  @ApiPropertyOptional({ type: ForeseeableLossFactsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ForeseeableLossFactsDto)
  foreseeableLosses?: ForeseeableLossFactsDto;

  @ApiPropertyOptional({ type: IepfFactsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => IepfFactsDto)
  iepf?: IepfFactsDto;

  @ApiPropertyOptional({ type: DividendFactsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DividendFactsDto)
  dividend?: DividendFactsDto;

  @ApiPropertyOptional({ enum: TRIS }) @OneOf(TRIS) booksProper?: Tri;
  @ApiPropertyOptional({ enum: TRIS }) @OneOf(TRIS) informationObtained?: Tri;
  @ApiPropertyOptional({ enum: TRIS }) @OneOf(TRIS) adverseObservations?: Tri;
  @ApiPropertyOptional({ enum: TRIS }) @OneOf(TRIS) accountsQualification?: Tri;

  @ApiPropertyOptional({
    description:
      'Per card key: { applicability, reason } to override the system applicability, or null to clear it. Validated server-side.',
  })
  @IsOptional()
  @IsObject()
  applicabilityOverrides?: Record<string, unknown>;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(1)
  version!: number;
}

/** Record the professional 02.7 conclusion (spec §3, §20). */
export class RecordOtherReportingDecisionDto {
  @ApiPropertyOptional({
    enum: OTHER_REPORTING_ACTIONS,
    description: 'Omitted = confirm when the conclusion matches the system, else override.',
  })
  @IsOptional()
  @IsIn(OTHER_REPORTING_ACTIONS)
  action?: OtherReportingAction;

  @ApiPropertyOptional({ enum: OTHER_REPORTING_CONCLUSIONS })
  @IsOptional()
  @IsIn(OTHER_REPORTING_CONCLUSIONS)
  conclusion?: OtherReportingOutcome;

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
    description: 'Supporting evidence (or link a file) — mandatory on override.',
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

/** Engagement Partner approval of a significant 02.7 override (spec §20). */
export class PartnerApproveOtherReportingDto {
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

/** Set one requirement card's work state (spec §16). */
export class UpdateReportingCardDto {
  @ApiPropertyOptional({ enum: REPORTING_WORK_STATUSES })
  @OneOf(REPORTING_WORK_STATUSES)
  workStatus?: ReportingWorkStatus;

  @ApiPropertyOptional({ enum: REPORTING_STATUSES, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(REPORTING_STATUSES)
  reportingStatus?: ReportingStatus | null;

  @ApiPropertyOptional({ nullable: true }) @Text() proposedConclusion?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  exceptions?: number;

  @ApiPropertyOptional({ nullable: true }) @Text() exceptionNote?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Text(500) sourceWorkpaper?: string | null;
  @ApiPropertyOptional({ description: 'true marks reviewed by you; false clears the review.' })
  @Bool()
  reviewed?: boolean;

  @ApiProperty({ description: 'Card version last seen (0 for a card never saved).' })
  @IsInt()
  @Min(0)
  version!: number;
}
