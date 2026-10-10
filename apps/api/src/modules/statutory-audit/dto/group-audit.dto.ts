import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBase64,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  BR01_ANSWERS,
  BRANCH_APPOINTMENT_BASES,
  BRANCH_CONCLUSIONS,
  COMPONENT_AUDITOR_TYPE,
  COMPONENT_REPORT_TYPES,
  COMPONENT_SIGNIFICANCE,
  FINDING_CATEGORIES,
  FINDING_IMPACTS,
  FINDING_STATUSES,
  GA01_ANSWERS,
  GA02_ANSWERS,
  GA_YES_NO_PENDING,
  GROUP_AUDIT_FILE_SLOTS,
  PACKAGE_DOCUMENT_KEYS,
  PACKAGE_DOCUMENT_STATUSES,
  SA600_CONSIDERATIONS,
  type AddGroupAuditFileInput,
  type Br01Answer,
  type BranchAppointmentBasis,
  type BranchConclusion,
  type ComponentAuditorType,
  type ComponentReportType,
  type ComponentSignificance,
  type CreateComponentInstructionsInput,
  type CreateGroupAuditBranchInput,
  type CreateGroupAuditFindingInput,
  type Ga01Answer,
  type Ga02Answer,
  type GaYesNoPending,
  type GroupAuditFileSlot,
  type GroupFindingCategory,
  type GroupFindingImpact,
  type GroupFindingStatus,
  type LinkGroupAuditFileInput,
  type PackageDocumentKey,
  type PackageDocumentStatus,
  type Sa600Consideration,
  type UpdateGroupAuditBranchInput,
  type UpdateGroupAuditComponentInput,
  type UpdateGroupAuditFindingInput,
  type UpdateGroupAuditInput,
  type UpdatePackageDocumentInput,
} from '@hsdg/contracts';

const AUDITOR_TYPES = Object.values(COMPONENT_AUDITOR_TYPE);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const nullable = () => ValidateIf((_o, v) => v !== null && v !== undefined);

class Versioned {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

function Text(max = 2000) {
  return function (target: object, key: string) {
    ApiPropertyOptional({ nullable: true })(target, key);
    IsOptional()(target, key);
    nullable()(target, key);
    IsString()(target, key);
    MaxLength(max)(target, key);
  };
}

function DateText() {
  return function (target: object, key: string) {
    ApiPropertyOptional({ nullable: true, description: 'YYYY-MM-DD' })(target, key);
    IsOptional()(target, key);
    nullable()(target, key);
    Matches(DATE)(target, key);
  };
}

// ── GA-01 / BR-01 ────────────────────────────────────────────────────────────

export class UpdateGroupAuditDto extends Versioned implements UpdateGroupAuditInput {
  @ApiPropertyOptional({
    enum: GA01_ANSWERS,
    nullable: true,
    description: 'Null = back to the system suggestion.',
  })
  @IsOptional()
  @nullable()
  @IsIn(GA01_ANSWERS)
  ga01?: Ga01Answer | null;

  @Text(4000)
  ga01Basis?: string | null;

  @ApiPropertyOptional({ enum: BR01_ANSWERS })
  @IsOptional()
  @IsIn(BR01_ANSWERS)
  br01?: Br01Answer;

  @Text(4000)
  br01Basis?: string | null;
}

// ── §12 / §13 matrix row ─────────────────────────────────────────────────────

export class UpdateGroupAuditComponentDto
  extends Versioned
  implements UpdateGroupAuditComponentInput
{
  @ApiPropertyOptional({ enum: AUDITOR_TYPES })
  @IsOptional()
  @IsIn(AUDITOR_TYPES)
  auditorType?: ComponentAuditorType;

  @Text(300) firmName?: string | null;
  @Text(100) frn?: string | null;
  @Text(200) professionalBody?: string | null;
  @Text(100) auditorCountry?: string | null;
  @Text(500) partnerContact?: string | null;
  @DateText() periodFrom?: string | null;
  @DateText() periodTo?: string | null;

  @ApiPropertyOptional({ enum: COMPONENT_REPORT_TYPES, nullable: true })
  @IsOptional()
  @nullable()
  @IsIn(COMPONENT_REPORT_TYPES)
  reportType?: ComponentReportType | null;

  @DateText() reportDate?: string | null;
  @DateText() reportingDeadline?: string | null;

  @ApiPropertyOptional({ enum: SA600_CONSIDERATIONS })
  @IsOptional()
  @IsIn(SA600_CONSIDERATIONS)
  sa600?: Sa600Consideration;

  @ApiPropertyOptional({ enum: COMPONENT_SIGNIFICANCE })
  @IsOptional()
  @IsIn(COMPONENT_SIGNIFICANCE)
  significance?: ComponentSignificance;

  @Text(4000) significanceNote?: string | null;

  @ApiPropertyOptional({ enum: GA02_ANSWERS })
  @IsOptional()
  @IsIn(GA02_ANSWERS)
  ga02?: Ga02Answer;

  @Text(4000) ga02Basis?: string | null;

  @ApiPropertyOptional({ enum: GA_YES_NO_PENDING })
  @IsOptional()
  @IsIn(GA_YES_NO_PENDING)
  ga03?: GaYesNoPending;

  @Text(4000) ga03Note?: string | null;

  @ApiPropertyOptional({ enum: GA_YES_NO_PENDING })
  @IsOptional()
  @IsIn(GA_YES_NO_PENDING)
  ga04?: GaYesNoPending;

  @Text(4000) ga04Basis?: string | null;
}

// ── Files (§12, §14, §15, §17) ───────────────────────────────────────────────

class FileTargetDto {
  @ApiProperty({ enum: GROUP_AUDIT_FILE_SLOTS })
  @IsIn(GROUP_AUDIT_FILE_SLOTS)
  slot!: GroupAuditFileSlot;

  @ApiProperty({ description: 'Matrix row (component slots) or branch record (branch slots).' })
  @IsUUID()
  ownerId!: string;

  @ApiPropertyOptional({ enum: PACKAGE_DOCUMENT_KEYS, nullable: true })
  @IsOptional()
  @nullable()
  @IsIn(PACKAGE_DOCUMENT_KEYS)
  packageKey?: PackageDocumentKey | null;

  @Text(2000) replaceReason?: string | null;
}

export class AddGroupAuditFileDto extends FileTargetDto implements AddGroupAuditFileInput {
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

  @Text(300) title?: string | null;
}

export class LinkGroupAuditFileDto extends FileTargetDto implements LinkGroupAuditFileInput {
  @ApiProperty({ description: 'A document already on this engagement.' })
  @IsUUID()
  documentId!: string;
}

export class UpdatePackageDocumentDto implements UpdatePackageDocumentInput {
  @ApiProperty({ enum: PACKAGE_DOCUMENT_STATUSES })
  @IsIn(PACKAGE_DOCUMENT_STATUSES)
  status!: PackageDocumentStatus;

  @Text(2000) note?: string | null;
}

// ── §16 findings ─────────────────────────────────────────────────────────────

export class CreateGroupAuditFindingDto implements CreateGroupAuditFindingInput {
  @ApiProperty({ enum: ['component', 'branch'] })
  @IsIn(['component', 'branch'])
  subjectKind!: 'component' | 'branch';

  @ApiProperty()
  @IsUUID()
  subjectId!: string;

  @ApiProperty({ enum: FINDING_CATEGORIES })
  @IsIn(FINDING_CATEGORIES)
  category!: GroupFindingCategory;

  @ApiProperty({ enum: FINDING_IMPACTS, isArray: true })
  @IsArray()
  @ArrayMaxSize(FINDING_IMPACTS.length)
  @IsIn(FINDING_IMPACTS, { each: true })
  impacts!: GroupFindingImpact[];

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  description!: string;

  @Text(500) icfrCrossRef?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  reportingConsideration?: boolean;
}

export class UpdateGroupAuditFindingDto extends Versioned implements UpdateGroupAuditFindingInput {
  @ApiPropertyOptional({ enum: FINDING_CATEGORIES })
  @IsOptional()
  @IsIn(FINDING_CATEGORIES)
  category?: GroupFindingCategory;

  @ApiPropertyOptional({ enum: FINDING_IMPACTS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FINDING_IMPACTS.length)
  @IsIn(FINDING_IMPACTS, { each: true })
  impacts?: GroupFindingImpact[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  description?: string;

  @Text(500) icfrCrossRef?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  escalated?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  reportingConsideration?: boolean;

  @ApiPropertyOptional({ enum: FINDING_STATUSES })
  @IsOptional()
  @IsIn(FINDING_STATUSES)
  status?: GroupFindingStatus;

  @Text(4000) response?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  withdrawn?: boolean;
}

// ── §17 branches ─────────────────────────────────────────────────────────────

export class CreateGroupAuditBranchDto implements CreateGroupAuditBranchInput {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  branchName!: string;

  @Text(300) location?: string | null;
  @Text(100) country?: string | null;
}

export class UpdateGroupAuditBranchDto extends Versioned implements UpdateGroupAuditBranchInput {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  branchName?: string;

  @Text(300) location?: string | null;
  @Text(100) country?: string | null;
  @Text(300) firmName?: string | null;
  @Text(100) frn?: string | null;
  @Text(500) partnerContact?: string | null;

  @ApiPropertyOptional({ enum: BRANCH_APPOINTMENT_BASES, nullable: true })
  @IsOptional()
  @nullable()
  @IsIn(BRANCH_APPOINTMENT_BASES)
  appointmentBasis?: BranchAppointmentBasis | null;

  @Text(2000) appointmentNote?: string | null;
  @DateText() periodFrom?: string | null;
  @DateText() periodTo?: string | null;

  @ApiPropertyOptional({ enum: COMPONENT_SIGNIFICANCE })
  @IsOptional()
  @IsIn(COMPONENT_SIGNIFICANCE)
  significance?: ComponentSignificance;

  @ApiPropertyOptional({ enum: GA02_ANSWERS })
  @IsOptional()
  @IsIn(GA02_ANSWERS)
  ga02?: Ga02Answer;

  @Text(4000) ga02Basis?: string | null;

  @ApiPropertyOptional({ enum: GA_YES_NO_PENDING })
  @IsOptional()
  @IsIn(GA_YES_NO_PENDING)
  ga03?: GaYesNoPending;

  @Text(4000) ga03Note?: string | null;

  @ApiPropertyOptional({ enum: GA_YES_NO_PENDING })
  @IsOptional()
  @IsIn(GA_YES_NO_PENDING)
  ga04?: GaYesNoPending;

  @Text(4000) ga04Basis?: string | null;
  @Text(4000) principalResponse?: string | null;

  @ApiPropertyOptional({ enum: BRANCH_CONCLUSIONS })
  @IsOptional()
  @IsIn(BRANCH_CONCLUSIONS)
  conclusion?: BranchConclusion;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  withdrawn?: boolean;
}

// ── §14 instructions ─────────────────────────────────────────────────────────

export class CreateComponentInstructionsDto implements CreateComponentInstructionsInput {
  @ApiPropertyOptional({ description: 'Template variant (default: the engagement selection).' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_]{1,60}$/)
  variantKey?: string;
}
