import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsObject, IsOptional, Max, Min } from 'class-validator';
import {
  ARTICLE_CLIENT_SCOPES,
  BULK_ASSIGN_SCOPES,
  FIRM_CHECK_KEYS,
  DEFAULT_REVIEWERS,
  REMINDER_CHANNEL_SETTINGS,
  TAX_AUDIT_LIMIT_MAX,
  type ArticleClientScope,
  type BulkAssignScope,
  type DefaultReviewer,
  type FirmChecks,
  type ReminderChannelSetting,
  type TaxAuditMilestoneOffsets,
} from '@hsdg/contracts';

export class UpdateWorkflowSettingsDto {
  @ApiProperty({ description: 'The version read; a stale one is a 409.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ enum: DEFAULT_REVIEWERS })
  @IsOptional()
  @IsIn(DEFAULT_REVIEWERS)
  defaultReviewer?: DefaultReviewer;

  @ApiPropertyOptional({ enum: ARTICLE_CLIENT_SCOPES })
  @IsOptional()
  @IsIn(ARTICLE_CLIENT_SCOPES)
  articleClientScope?: ArticleClientScope;

  @ApiPropertyOptional({ enum: REMINDER_CHANNEL_SETTINGS })
  @IsOptional()
  @IsIn(REMINDER_CHANNEL_SETTINGS)
  clientReminderChannel?: ReminderChannelSetting;

  @ApiPropertyOptional({ enum: BULK_ASSIGN_SCOPES })
  @IsOptional()
  @IsIn(BULK_ASSIGN_SCOPES)
  bulkAssignScope?: BulkAssignScope;

  @ApiPropertyOptional({ minimum: 0, maximum: 60, description: 'Remind T-n of the internal date.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  clientReminderDays?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 60,
    description: 'Escalate T-n of the internal date.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  clientEscalationDays?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: TAX_AUDIT_LIMIT_MAX,
    description: 'Tax audit reports one partner may sign in a financial year (ICAI: 60 at most).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TAX_AUDIT_LIMIT_MAX, {
    message: `ICAI allows at most ${TAX_AUDIT_LIMIT_MAX} tax audit reports a partner a year; the firm may set it lower, not higher.`,
  })
  taxAuditLimit?: number;

  @ApiPropertyOptional({
    description:
      "Days before a tax audit's due date each internal milestone falls (F-9): any subset of applicability, accepted, info_requests, info_received, clause_work, review, signed, uploaded, client_accepted; whole days 0–365.",
    example: { review: 20 },
  })
  @IsOptional()
  @IsObject()
  taxAuditMilestoneOffsets?: Partial<TaxAuditMilestoneOffsets>;
}

export class UpdateFormInternalDueDto {
  @ApiProperty({ minimum: 0, maximum: 60, description: 'Days before the statutory date.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  internalSlaOffsetDays!: number;
}

export class UpdateFirmChecksDto {
  @ApiProperty({ description: 'The version read; a stale one is a 409.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({
    description: `Check → on (true) or off (false); checks not named keep their state. Keys: ${FIRM_CHECK_KEYS.join(', ')}.`,
    type: 'object',
    additionalProperties: { type: 'boolean' },
  })
  @IsObject()
  checks!: Partial<FirmChecks>;
}
