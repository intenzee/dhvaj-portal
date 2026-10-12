import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ACTIVITY_KIND, STREAMS, type ActivityKind, type Stream } from '@hsdg/contracts';

const KINDS = Object.values(ACTIVITY_KIND) as ActivityKind[];

/** GET /engagements/:id/activity — Activity → Timeline filters. */
export class ActivityQueryDto {
  @ApiPropertyOptional({
    enum: STREAMS,
    description: 'Only this stream (engagement-level rows drop out).',
  })
  @IsOptional()
  @IsIn(STREAMS)
  stream?: Stream;

  @ApiPropertyOptional({ description: 'Only rows whose actor is this employee.' })
  @IsOptional()
  @IsUUID()
  person?: string;

  @ApiPropertyOptional({ description: 'Comma-separated kinds, e.g. comment,filing_lodged.' })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : value,
  )
  @IsIn(KINDS, { each: true })
  kind?: ActivityKind[];

  @ApiPropertyOptional({ description: 'Only pinned comments (Overview widget).' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  pinned?: boolean;

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page.' })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  cursor?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
