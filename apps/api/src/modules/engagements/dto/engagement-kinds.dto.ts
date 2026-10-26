import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  BILLING_MODELS,
  ENGAGEMENT_KINDS,
  FEE_PERIODS,
  INDEPENDENCE_RULE,
  STREAMS,
  type EngagementKind,
  type FeePeriod,
  type IndependenceRule,
  type Stream,
} from '@hsdg/contracts';

const FY = /^[0-9]{4}-[0-9]{2}$/;
const FY_MESSAGE = 'financialYear must look like 2026-27';
const RULES = Object.values(INDEPENDENCE_RULE);

/** A year in scope on a Compliance engagement (compliance_engagement_years). */
export class ComplianceYearDto {
  @ApiProperty({ example: '2026-27' })
  @Matches(FY, { message: FY_MESSAGE })
  financialYear!: string;

  @ApiPropertyOptional({ description: 'Fee (₹) for each `feePeriod`.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  feeAmount?: number | null;

  @ApiPropertyOptional({ enum: FEE_PERIODS, description: 'CM-4 · what period the fee is for.' })
  @IsOptional()
  @IsIn(FEE_PERIODS)
  feePeriod?: FeePeriod;

  @ApiPropertyOptional({ enum: BILLING_MODELS })
  @IsOptional()
  @IsIn(BILLING_MODELS)
  billingModel?: string | null;

  @ApiPropertyOptional({ description: '{stream: hours} — Activity → Time budget.' })
  @IsOptional()
  @IsObject()
  budgetHours?: Partial<Record<Stream, number>>;

  @ApiPropertyOptional({ description: 'Engagement letter / scope renewal reference.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  engagementLetterRef?: string | null;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsDateString()
  engagementLetterDate?: string | null;

  @ApiPropertyOptional({ description: 's.144 board / audit-committee approval reference.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  s144ApprovalRef?: string | null;
}

export class AddComplianceYearDto extends ComplianceYearDto {
  @ApiPropertyOptional({
    enum: STREAMS,
    isArray: true,
    description: 'Defaults to the latest year’s.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(STREAMS, { each: true })
  streams?: Stream[];

  @ApiPropertyOptional({
    description: '{stream: registration ids}; defaults to the latest year’s.',
  })
  @IsOptional()
  @IsObject()
  streamRegistrations?: Partial<Record<Stream, string[]>>;

  @ApiPropertyOptional({ enum: RULES, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(RULES, { each: true })
  acknowledgedIndependenceRules?: IndependenceRule[];
}

export class UpdateComplianceYearDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  feeAmount?: number | null;

  @ApiPropertyOptional({ enum: FEE_PERIODS, description: 'CM-4 · what period the fee is for.' })
  @IsOptional()
  @IsIn(FEE_PERIODS)
  feePeriod?: FeePeriod;

  @ApiPropertyOptional({ enum: BILLING_MODELS })
  @IsOptional()
  @IsIn([...BILLING_MODELS, null])
  billingModel?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  budgetHours?: Partial<Record<Stream, number>>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  engagementLetterRef?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  engagementLetterDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  s144ApprovalRef?: string | null;

  @ApiPropertyOptional({ enum: ['open', 'closed'], description: 'Close or reopen the year.' })
  @IsOptional()
  @IsIn(['open', 'closed'])
  status?: 'open' | 'closed';

  @ApiProperty()
  @IsInt()
  version!: number;
}

export class UpdateYearStreamsDto {
  @ApiPropertyOptional({ enum: STREAMS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(STREAMS, { each: true })
  add?: Stream[];

  @ApiPropertyOptional({ enum: STREAMS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(STREAMS, { each: true })
  end?: Stream[];

  @ApiPropertyOptional({ description: '{stream: registration ids}' })
  @IsOptional()
  @IsObject()
  streamRegistrations?: Partial<Record<Stream, string[]>>;

  @ApiPropertyOptional({ description: '{stream: lead employee id} for added streams' })
  @IsOptional()
  @IsObject()
  streamLeads?: Partial<Record<Stream, string>>;

  @ApiPropertyOptional({ enum: RULES, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(RULES, { each: true })
  acknowledgedIndependenceRules?: IndependenceRule[];

  @ApiProperty()
  @IsInt()
  version!: number;
}

export class IndependenceCheckDto {
  @ApiProperty()
  @IsUUID()
  entityId!: string;

  @ApiProperty({ enum: ENGAGEMENT_KINDS })
  @IsIn(ENGAGEMENT_KINDS)
  kind!: EngagementKind;

  @ApiProperty({ example: ['2026-27'] })
  @IsArray()
  @ArrayMinSize(1)
  @Matches(FY, { each: true, message: FY_MESSAGE })
  financialYears!: string[];

  @ApiPropertyOptional({ enum: STREAMS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(STREAMS, { each: true })
  streams?: Stream[];

  @ApiPropertyOptional({ description: 'Assignment: the service it carries.' })
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  s144ApprovalRef?: string | null;

  @ApiPropertyOptional({ description: 'Adding to this existing engagement.' })
  @IsOptional()
  @IsUUID()
  engagementId?: string;
}
