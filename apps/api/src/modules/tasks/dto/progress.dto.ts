import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  PROGRESS_GROUPS,
  PROGRESS_STATUSES,
  type ProgressGroup,
  type ProgressStatus,
} from '@hsdg/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

/** GET /work/progress — the period (internal due date) and the filters. */
export class ProgressQueryDto {
  @ApiPropertyOptional({ enum: PROGRESS_GROUPS, default: 'person' })
  @IsOptional()
  @IsIn(PROGRESS_GROUPS)
  groupBy?: ProgressGroup;

  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'Internal due date from (inclusive).',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30', description: 'Internal due date to (inclusive).' })
  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;

  @ApiPropertyOptional({ description: "The engagement's office." })
  @IsOptional()
  @IsUUID()
  officeId?: string;

  @ApiPropertyOptional({
    description: 'A stream (gst, income_tax, …) or statutory_audit / assignment.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  stream?: string;

  @ApiPropertyOptional({ description: "The client's team." })
  @IsOptional()
  @IsUUID()
  teamId?: string;
}

/** GET /work/progress/items — the same filters, one row's key, and a status. */
export class ProgressItemsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PROGRESS_GROUPS })
  @IsOptional()
  @IsIn(PROGRESS_GROUPS)
  groupBy?: ProgressGroup;

  @ApiPropertyOptional({ description: "A row's key from GET /work/progress (with its groupBy)." })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  key?: string;

  @ApiPropertyOptional({ enum: PROGRESS_STATUSES })
  @IsOptional()
  @IsIn(PROGRESS_STATUSES)
  progress?: ProgressStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  overdueOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  officeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  stream?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  teamId?: string;
}
