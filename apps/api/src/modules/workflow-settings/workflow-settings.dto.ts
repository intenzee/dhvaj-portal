import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  ARTICLE_CLIENT_SCOPES,
  BULK_ASSIGN_SCOPES,
  DEFAULT_REVIEWERS,
  REMINDER_CHANNEL_SETTINGS,
  type ArticleClientScope,
  type BulkAssignScope,
  type DefaultReviewer,
  type ReminderChannelSetting,
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
}

export class UpdateFormInternalDueDto {
  @ApiProperty({ minimum: 0, maximum: 60, description: 'Days before the statutory date.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  internalSlaOffsetDays!: number;
}
