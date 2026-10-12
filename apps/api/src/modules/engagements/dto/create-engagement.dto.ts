import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  BILLING_MODELS,
  ENGAGEMENT_CONFIDENTIALITIES,
  ENGAGEMENT_KINDS,
  INDEPENDENCE_RULE,
  STREAMS,
  ENGAGEMENT_PRIORITIES,
  ENGAGEMENT_STATUSES,
  ENGAGEMENT_TYPES,
  type BillingModel,
  type EngagementConfidentiality,
  type EngagementKind,
  type IndependenceRule,
  type Stream,
  type EngagementPriority,
  type EngagementStatus,
  type EngagementType,
} from '@hsdg/contracts';
import { ComplianceYearDto } from './engagement-kinds.dto';

export class CreateEngagementDto {
  @ApiPropertyOptional({
    enum: ENGAGEMENT_KINDS,
    description:
      'statutory_audit (service fixed to STAT_AUDIT), compliance (streams + years in scope) or ' +
      'assignment. Omitted: derived from the service, as before.',
  })
  @IsOptional()
  @IsIn(ENGAGEMENT_KINDS)
  kind?: EngagementKind;

  @ApiProperty({ description: 'Client entity id.' })
  @IsUUID()
  entityId!: string;

  @ApiPropertyOptional({
    description:
      'Service id (from the catalogue). Required for an assignment or when kind is omitted; ' +
      'a Statutory Audit uses STAT_AUDIT and a Compliance engagement its stream services.',
  })
  @ValidateIf(
    (o: CreateEngagementDto) =>
      o.kind === undefined || o.kind === 'assignment' || o.serviceId !== undefined,
  )
  @IsUUID()
  serviceId?: string;

  @ApiProperty({ example: '2024-25', description: 'Financial year (YYYY-YY).' })
  @Matches(/^[0-9]{4}-[0-9]{2}$/, { message: 'financialYear must look like 2024-25' })
  financialYear!: string;

  @ApiPropertyOptional({ example: 'FY', description: 'Period label (FY, Q1, Apr-2024…).' })
  @IsOptional()
  @IsString()
  periodLabel?: string;

  @ApiPropertyOptional({
    description: 'Servicing office code (defaults to the client’s home office).',
  })
  @IsOptional()
  @IsString()
  officeCode?: string;

  @ApiPropertyOptional({ description: 'Accountable EP employee id (defaults to the creator).' })
  @IsOptional()
  @IsUUID()
  engagementPartnerEmployeeId?: string;

  @ApiPropertyOptional({ description: 'Engagement manager employee id.' })
  @IsOptional()
  @IsUUID()
  engagementManagerEmployeeId?: string;

  @ApiPropertyOptional({ enum: ENGAGEMENT_STATUSES, default: 'prospect' })
  @IsOptional()
  @IsIn(ENGAGEMENT_STATUSES)
  status?: EngagementStatus;

  @ApiPropertyOptional({ description: 'Predecessor engagement id (recurring work).' })
  @IsOptional()
  @IsUUID()
  predecessorEngagementId?: string;

  @ApiPropertyOptional({ example: '2024-04-01' })
  @IsOptional()
  @IsDateString()
  plannedStartDate?: string;

  @ApiPropertyOptional({ example: '2025-03-31' })
  @IsOptional()
  @IsDateString()
  plannedEndDate?: string;

  @ApiPropertyOptional({ enum: ENGAGEMENT_TYPES, default: 'recurring_compliance' })
  @IsOptional()
  @IsIn(ENGAGEMENT_TYPES)
  engagementType?: EngagementType;

  @ApiPropertyOptional({ enum: ENGAGEMENT_PRIORITIES, default: 'normal' })
  @IsOptional()
  @IsIn(ENGAGEMENT_PRIORITIES)
  priority?: EngagementPriority;

  @ApiPropertyOptional({ enum: ENGAGEMENT_CONFIDENTIALITIES, default: 'normal' })
  @IsOptional()
  @IsIn(ENGAGEMENT_CONFIDENTIALITIES)
  confidentiality?: EngagementConfidentiality;

  @ApiPropertyOptional({ example: 'INR', description: 'ISO 4217 code (3 uppercase letters).' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO code, e.g. INR' })
  currency?: string;

  @ApiPropertyOptional({ enum: BILLING_MODELS })
  @IsOptional()
  @IsIn(BILLING_MODELS)
  billingModel?: BillingModel;

  @ApiPropertyOptional({ description: 'Mandate / engagement-letter reference.' })
  @IsOptional()
  @IsString()
  mandateLetterReference?: string;

  @ApiPropertyOptional({ example: '2024-04-01' })
  @IsOptional()
  @IsDateString()
  mandateLetterDate?: string;

  // ── Compliance (spec Change 1, step 4) ─────────────────────────────────
  @ApiPropertyOptional({
    type: [ComplianceYearDto],
    description: 'Years in scope (default: financialYear). The first is the year of commencement.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ComplianceYearDto)
  years?: ComplianceYearDto[];

  @ApiPropertyOptional({ enum: STREAMS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(STREAMS, { each: true })
  streams?: Stream[];

  @ApiPropertyOptional({ description: '{stream: registration ids} (default: every matching one).' })
  @IsOptional()
  @IsObject()
  streamRegistrations?: Partial<Record<Stream, string[]>>;

  @ApiPropertyOptional({ description: '{stream: lead employee id}' })
  @IsOptional()
  @IsObject()
  streamLeads?: Partial<Record<Stream, string>>;

  @ApiPropertyOptional({
    enum: Object.values(INDEPENDENCE_RULE),
    isArray: true,
    description: 'Warnings the partner acknowledges (e.g. NON_COMPANY_AUDIT_ACK).',
  })
  @IsOptional()
  @IsArray()
  @IsIn(Object.values(INDEPENDENCE_RULE), { each: true })
  acknowledgedIndependenceRules?: IndependenceRule[];
}
