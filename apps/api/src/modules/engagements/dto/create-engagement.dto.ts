import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import {
  BILLING_MODELS,
  ENGAGEMENT_CONFIDENTIALITIES,
  ENGAGEMENT_PRIORITIES,
  ENGAGEMENT_STATUSES,
  ENGAGEMENT_TYPES,
  type BillingModel,
  type EngagementConfidentiality,
  type EngagementPriority,
  type EngagementStatus,
  type EngagementType,
} from '@hsdg/contracts';

export class CreateEngagementDto {
  @ApiProperty({ description: 'Client entity id.' })
  @IsUUID()
  entityId!: string;

  @ApiProperty({ description: 'Service id (from the catalogue).' })
  @IsUUID()
  serviceId!: string;

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
}
