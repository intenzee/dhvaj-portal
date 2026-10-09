import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
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
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ACCOUNTING_ENVIRONMENTS,
  ACCOUNTING_SOFTWARES,
  CONFIRMABLE_PROFILE_CARDS,
  PROFILE_FINANCIAL_PARAMETERS,
  PROFILE_FINANCIAL_SOURCES,
  REGULATORS,
  SERVICE_ORG_ANSWERS,
  SPECIAL_ENTITY_TYPES,
  YES_NO_PENDING_VALUES,
  YES_NO_VALUES,
  type AccountingEnvironment,
  type AccountingSoftware,
  type ConfirmableProfileCard,
  type ProfileFinancialParameter,
  type ProfileFinancialSource,
  type Regulator,
  type ServiceOrgAnswer,
  type SpecialEntityType,
  type YesNo,
  type YesNoPending,
} from '@hsdg/contracts';

/** One other joint auditor (Card I). */
export class JointAuditorDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  firmName!: string;

  @ApiPropertyOptional({ description: 'ICAI Firm Registration Number', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  frn?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  contact?: string | null;
}

/** Save Draft — the facts the audit team holds on the 02.1 profile. */
export class UpdateEntityProfileDto {
  @ApiPropertyOptional({ enum: SPECIAL_ENTITY_TYPES, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(SPECIAL_ENTITY_TYPES, { each: true })
  specialEntityTypes?: SpecialEntityType[];

  @ApiPropertyOptional({ description: 'First-year audit — overrides the system-derived value.' })
  @IsOptional()
  @IsBoolean()
  initialAudit?: boolean;

  @ApiPropertyOptional({ description: 'Joint audit — drives SA 299.' })
  @IsOptional()
  @IsBoolean()
  jointAudit?: boolean;

  @ApiPropertyOptional({ enum: ACCOUNTING_ENVIRONMENTS, nullable: true })
  @IsOptional()
  @IsIn([...ACCOUNTING_ENVIRONMENTS, null])
  accountingEnvironment?: AccountingEnvironment | null;

  @ApiPropertyOptional({
    enum: YES_NO_PENDING_VALUES,
    nullable: true,
    description: 'ERP-03 listed?',
  })
  @IsOptional()
  @IsIn([...YES_NO_PENDING_VALUES, null])
  listingAnswer?: YesNoPending | null;

  @ApiPropertyOptional({
    enum: YES_NO_PENDING_VALUES,
    nullable: true,
    description: 'In process of listing?',
  })
  @IsOptional()
  @IsIn([...YES_NO_PENDING_VALUES, null])
  listingInProcess?: YesNoPending | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nbfcCategory?: string | null;

  @ApiPropertyOptional({ enum: REGULATORS, nullable: true })
  @IsOptional()
  @IsIn([...REGULATORS, null])
  regulator?: Regulator | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  regulatorName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  regulatorDetails?: string | null;

  @ApiPropertyOptional({ enum: YES_NO_VALUES, nullable: true })
  @IsOptional()
  @IsIn([...YES_NO_VALUES, null])
  differentFyApproved?: YesNo | null;

  @ApiPropertyOptional({ enum: ACCOUNTING_SOFTWARES, nullable: true })
  @IsOptional()
  @IsIn([...ACCOUNTING_SOFTWARES, null])
  accountingSoftware?: AccountingSoftware | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  accountingSoftwareOther?: string | null;

  @ApiPropertyOptional({ enum: YES_NO_VALUES, nullable: true })
  @IsOptional()
  @IsIn([...YES_NO_VALUES, null])
  recordsElectronic?: YesNo | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  recordsDescription?: string | null;

  @ApiPropertyOptional({ enum: SERVICE_ORG_ANSWERS, nullable: true })
  @IsOptional()
  @IsIn([...SERVICE_ORG_ANSWERS, null])
  serviceOrg?: ServiceOrgAnswer | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  serviceOrgService?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  serviceOrgProvider?: string | null;

  @ApiPropertyOptional({ type: [JointAuditorDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => JointAuditorDto)
  jointAuditors?: JointAuditorDto[];

  @ApiProperty({ description: 'Optimistic-concurrency version last seen for the profile.' })
  @IsInt()
  @Min(1)
  version!: number;
}

/** Confirm one card (A/B/C/E/F/H/I). */
export class ConfirmProfileCardDto {
  @ApiProperty({ enum: CONFIRMABLE_PROFILE_CARDS })
  @IsIn(CONFIRMABLE_PROFILE_CARDS as unknown as string[])
  card!: ConfirmableProfileCard;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

/** Card E — Confirm Assessment / Override / clear the override. */
export class SmallCompanyDecisionDto {
  @ApiProperty({ enum: ['confirm', 'override', 'clear_override'] })
  @IsIn(['confirm', 'override', 'clear_override'])
  action!: 'confirm' | 'override' | 'clear_override';

  @ApiPropertyOptional({ enum: ['small', 'not_small'] })
  @IsOptional()
  @IsIn(['small', 'not_small'])
  outcome?: 'small' | 'not_small';

  @ApiPropertyOptional({ description: 'Mandatory for an override.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  reason?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

/** Controlled reopen of a confirmed profile. */
export class ReopenProfileDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  reason!: string;
}

/** Capture one financial parameter (current + prior FY) — guide §9.1 Card D. */
export class CaptureProfileFinancialDto {
  @ApiProperty({ enum: PROFILE_FINANCIAL_PARAMETERS })
  @IsIn(PROFILE_FINANCIAL_PARAMETERS)
  parameter!: ProfileFinancialParameter;

  @ApiPropertyOptional({ description: 'Current-year figure (INR).', nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  currentValue?: number | null;

  @ApiPropertyOptional({ description: 'Prior-year figure (INR).', nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priorValue?: number | null;

  @ApiPropertyOptional({ enum: PROFILE_FINANCIAL_SOURCES, nullable: true })
  @IsOptional()
  @IsIn(PROFILE_FINANCIAL_SOURCES)
  source?: ProfileFinancialSource | null;

  @ApiPropertyOptional({
    description: 'Who prepared the figure (defaults to the signed-in person).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  preparer?: string | null;

  @ApiPropertyOptional({ description: 'Link an existing document as evidence (never a copy).' })
  @IsOptional()
  @IsUUID()
  documentId?: string | null;
}

/** Confirm the profile — freezes the fact set for 02.2–02.9 (Completion). */
export class ConfirmProfileDto {
  @ApiPropertyOptional({ description: 'Optional note recorded with the confirmation.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;

  @ApiProperty({ description: 'The Manager accepts the confirmation statement.' })
  @IsBoolean()
  @Equals(true, { message: 'Accept the confirmation statement to confirm the profile.' })
  acknowledged!: boolean;
}

const SLOT_PATTERN = /^(different_fy|service_org|joint_audit|financial:[a-z_]+)$/;

/** Add a new file to a 02.1 field. */
export class AddProfileFileDto {
  @ApiProperty({ example: 'financial:net_worth' })
  @Matches(SLOT_PATTERN)
  slot!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contentType?: string;

  @ApiProperty({ description: 'File bytes, base64.' })
  @IsString()
  @IsNotEmpty()
  contentBase64!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;
}

/** Link an existing engagement document to a 02.1 field. */
export class LinkProfileFileDto {
  @ApiProperty({ example: 'service_org' })
  @Matches(SLOT_PATTERN)
  slot!: string;

  @ApiProperty()
  @IsUUID()
  documentId!: string;
}

/** Methodology administration — the in-portal viewer's content. */
export class UpdateAuthorityProvisionDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  summary?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'https:// link to the MCA / ICAI source.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Matches(/^https:\/\//, { message: 'The source link must start with https://' })
  sourceUrl?: string | null;
}
