import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  OTHER_TIME_CATEGORIES,
  TIME_SUMMARY_BY,
  type OtherTimeCategory,
  type TimeSummaryBy,
} from '@hsdg/contracts';

/** Activity → Time → Add other time (client call, meeting, travel …). */
export class OtherTimeDto {
  @ApiProperty({ enum: OTHER_TIME_CATEGORIES })
  @IsIn(OTHER_TIME_CATEGORIES)
  category!: OtherTimeCategory;

  @ApiPropertyOptional({ description: 'The stream (engagement service) the time belongs to.' })
  @IsOptional()
  @IsUUID()
  engagementServiceId?: string;

  @ApiProperty({ minimum: 1, maximum: 720 })
  @IsInt()
  @Min(1)
  @Max(720)
  minutes!: number;

  @ApiProperty({ example: '2026-10-12', description: 'Day (IST); today or the last 3 days.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ description: 'Defaults by category (meetings/training/admin are not).' })
  @IsOptional()
  @IsBoolean()
  isBillable?: boolean;
}

export class AdjustTimeDto {
  @ApiProperty()
  @IsISO8601()
  startedAt!: string;

  @ApiProperty()
  @IsISO8601()
  endedAt!: string;

  @ApiProperty({ description: 'Why the entry is being corrected.' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class DecideAdjustmentDto {
  @ApiPropertyOptional({ default: true, description: 'false rejects the correction.' })
  @IsOptional()
  @IsBoolean()
  approve?: boolean;
}

export class TimeSummaryQueryDto {
  @ApiPropertyOptional({ enum: Object.values(TIME_SUMMARY_BY), default: 'person' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsIn(Object.values(TIME_SUMMARY_BY))
  by?: TimeSummaryBy;

  @ApiPropertyOptional({ description: 'Only time on or after this IST date (YYYY-MM-DD).' })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({ description: 'Only time on or before this IST date (YYYY-MM-DD).' })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @ApiPropertyOptional({ description: 'Only time in this stream (gst, tds, …).' })
  @IsOptional()
  @IsIn(['gst', 'tds', 'income_tax', 'roc', 'bookkeeping', 'mis'])
  stream?: string;
}
