import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { CLIENT_REMINDER_CHANNEL, type ClientReminderChannel } from '@hsdg/contracts';
import type { FilingRunScope } from '../filing-runs.service';

const SCOPES: FilingRunScope[] = ['mine', 'team'];

export class FilingRunFormsQueryDto {
  @ApiPropertyOptional({ enum: SCOPES, description: 'Omit for every filing the caller can see.' })
  @IsOptional()
  @IsIn(SCOPES)
  scope?: FilingRunScope;
}

export class FilingRunQueryDto extends FilingRunFormsQueryDto {
  @ApiProperty({ example: 'GST_GSTR1_M', description: 'The compliance rule code.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  rule!: string;

  @ApiProperty({ example: '2026-09', description: 'A period key: 2026-09, 2026-27, 2026-27:Q1 …' })
  @IsString()
  @Matches(/^[\w:.-]{4,80}$/)
  period!: string;
}

export class FilingRunInstancesDto {
  @ApiProperty({ type: [String], description: 'Filings (compliance instances), at most 200.' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  instanceIds!: string[];
}

export class FilingRunAssignDto extends FilingRunInstancesDto {
  @ApiPropertyOptional({ nullable: true, description: 'Omit to keep; null to unassign.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  preparerId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Omit to keep; null to clear.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  reviewerId?: string | null;
}

const CHANNELS = Object.values(CLIENT_REMINDER_CHANNEL);

/** POST /compliance-instances/:id/client-chase/remind (PS-001). */
export class ClientReminderDto {
  @ApiPropertyOptional({
    enum: CHANNELS,
    description:
      'Send this way instead of the firm’s channel; refused (400) when the client cannot be reached on it.',
  })
  @IsOptional()
  @IsIn(CHANNELS)
  channel?: ClientReminderChannel;
}
