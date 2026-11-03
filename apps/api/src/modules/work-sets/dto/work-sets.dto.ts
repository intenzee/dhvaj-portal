import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  WORK_SET_SIDES,
  type AssignableTaskFilters,
  type CreateWorkSetInput,
  type SplitWorkSetInput,
  type WorkSetSide,
} from '@hsdg/contracts';

/** GET /work-sets/open-tasks. */
export class OpenTasksQueryDto implements AssignableTaskFilters {
  @ApiPropertyOptional({ example: 'gst' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  stream?: string;

  @ApiPropertyOptional({ example: 'GSTR-1' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  form?: string;

  @ApiPropertyOptional({ example: '2026-10', description: 'A period key.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  period?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  officeId?: string;

  @ApiPropertyOptional({ description: "An employee id, or 'none' for tasks nobody holds." })
  @IsOptional()
  @Matches(/^(none|[0-9a-f-]{36})$/i)
  ownerId?: string;

  @ApiPropertyOptional({ example: 7, description: 'Due within this many days, overdue included.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(366)
  dueWithinDays?: number;
}

/** GET /work-sets/people. */
export class WorkSetPeopleQueryDto {
  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'Only the people below the caller.',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  below?: 'true' | 'false';
}

/** GET /work-sets. */
export class WorkSetsQueryDto {
  @ApiPropertyOptional({ enum: WORK_SET_SIDES, default: 'assigned_to' })
  @IsOptional()
  @IsIn(WORK_SET_SIDES)
  mine?: WorkSetSide;
}

/** POST /work-sets. */
export class CreateWorkSetDto implements CreateWorkSetInput {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  taskIds!: string[];

  @ApiProperty({ description: 'Who gets the set.' })
  @IsUUID()
  assignedToId!: string;

  @ApiPropertyOptional({ example: 'GSTR-1 Oct 2026 — Arjun' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string | null;

  @ApiPropertyOptional({ example: '2026-11-09', description: 'Every task becomes due then.' })
  @IsOptional()
  @IsDateString({ strict: true })
  dueDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

/** POST /work-sets/:id/split. */
export class SplitWorkSetDto implements SplitWorkSetInput {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  taskIds!: string[];

  @ApiProperty({ description: 'Who takes them: someone below the caller.' })
  @IsUUID()
  toEmployeeId!: string;

  @ApiPropertyOptional({ description: 'Kept on each task’s assignment history.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
