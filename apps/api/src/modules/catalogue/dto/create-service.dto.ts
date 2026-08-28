import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { RECURRENCES, type Recurrence } from '@hsdg/contracts';

export class CreateServiceDto {
  @ApiProperty({ example: 'AUDIT', description: 'Service line code.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9_]{2,30}$/, { message: 'serviceLineCode must be UPPER_SNAKE (A-Z, 0-9, _)' })
  serviceLineCode!: string;

  @ApiProperty({ example: 'STAT_AUDIT' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9_]{2,40}$/, { message: 'code must be UPPER_SNAKE (A-Z, 0-9, _)' })
  code!: string;

  @ApiProperty({ example: 'Statutory Audit' })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'full_ep_review', description: 'Required (minimum) review-model slug.' })
  @IsString()
  requiredReviewModel!: string;

  @ApiProperty({ example: 'audit_workflow', description: 'Workflow family slug.' })
  @IsString()
  workflowFamily!: string;

  @ApiPropertyOptional({ enum: RECURRENCES, default: 'annual' })
  @IsOptional()
  @IsIn(RECURRENCES)
  defaultRecurrence?: Recurrence;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Authorised catalogue-approval reference. Required (with service.manage_other) ' +
      'when the service is created under the OTHER "Other Professional Services" line (spec §17).',
    example: 'MP-APPROVAL-2026-014',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  approvalReference?: string;
}
