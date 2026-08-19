import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { ENGAGEMENT_STATUSES, type EngagementStatus } from '@hsdg/contracts';

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
}
