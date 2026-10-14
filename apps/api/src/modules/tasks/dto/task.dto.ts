import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  WORK_TYPES,
  type TaskPriority,
  type TaskStatus,
  type WorkSection,
  type WorkType,
} from '@hsdg/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';
import { SectionQuery } from '../../../common/sections';

const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

export class CreateTaskDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ description: 'Assignee — must be on the engagement (EP/manager/team).' })
  @IsOptional()
  @IsUUID()
  assignedToEmployeeId?: string;

  @ApiPropertyOptional({ enum: TASK_PRIORITIES })
  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: TaskPriority;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ description: '§31 — flag ad-hoc work as out-of-scope of the mandate.' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isOutOfScope?: boolean;

  @ApiPropertyOptional({ description: '§31 — mark the work billable to the client.' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isBillable?: boolean;

  @ApiPropertyOptional({
    description: 'Change 3 — the stream (engagement service) this work is in.',
  })
  @IsOptional()
  @IsUUID()
  engagementServiceId?: string;

  @ApiPropertyOptional({ description: 'Reviewer — must be on the engagement.' })
  @IsOptional()
  @IsUUID()
  reviewerEmployeeId?: string;

  @ApiPropertyOptional({ enum: WORK_TYPES })
  @IsOptional()
  @IsIn(WORK_TYPES)
  workType?: WorkType;

  @ApiPropertyOptional({ description: 'The filing (compliance instance) this task produces.' })
  @IsOptional()
  @IsUUID()
  complianceInstanceId?: string;
}

/** §31 — a lead's approval of an out-of-scope request. */
export class ApproveOutOfScopeDto {
  @ApiPropertyOptional({ description: 'Whether the approved work is billable to the client.' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isBillable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class UpdateTaskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'null to unassign.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  assignedToEmployeeId?: string | null;

  @ApiPropertyOptional({ enum: TASK_PRIORITIES })
  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: TaskPriority;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  dueDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  engagementServiceId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  reviewerEmployeeId?: string | null;

  @ApiPropertyOptional({ enum: WORK_TYPES, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(WORK_TYPES)
  workType?: WorkType | null;

  @ApiPropertyOptional({
    description: 'Expected version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class UpdateTaskStatusDto {
  @ApiProperty({ enum: TASK_STATUSES })
  @IsIn(TASK_STATUSES)
  status!: TaskStatus;

  @ApiPropertyOptional({
    description: 'Expected version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class AddDependencyDto {
  @ApiProperty({ description: 'The task this one is blocked by.' })
  @IsUUID()
  dependsOnTaskId!: string;
}

export class TaskListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TASK_STATUSES })
  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: TaskStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedToEmployeeId?: string;

  @ApiPropertyOptional({ description: 'Only tasks in this stream (engagement service).' })
  @IsOptional()
  @IsUUID()
  engagementServiceId?: string;

  @ApiPropertyOptional({ description: 'Only tasks in this stream (gst, tds, income_tax, …).' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  stream?: string;

  @ApiPropertyOptional({ enum: WORK_TYPES })
  @IsOptional()
  @IsIn(WORK_TYPES)
  workType?: WorkType;

  @ApiPropertyOptional({ description: 'Only the task(s) producing this filing.' })
  @IsOptional()
  @IsUUID()
  complianceInstanceId?: string;

  @ApiPropertyOptional({ description: 'Only live tasks (not done / cancelled).' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  open?: boolean;
}

/** Body for the Change 3 task transitions. */
export class TaskTransitionDto {
  @ApiPropertyOptional({
    description:
      'Return: the review points (required). Waiting on client: what is needed (required). ' +
      'Otherwise an optional note.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  @ApiPropertyOptional({ description: 'Waiting on client: when to escalate the request.' })
  @IsOptional()
  @IsDateString()
  escalationDate?: string;

  @ApiPropertyOptional({
    description: 'Send for review: the reviewer (defaults to the manager, else the partner).',
  })
  @IsOptional()
  @IsUUID()
  reviewerEmployeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class MyTasksQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TASK_STATUSES })
  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: TaskStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  overdueOnly?: boolean;

  @SectionQuery()
  section?: WorkSection[];

  @ApiPropertyOptional({
    enum: ['mine', 'team'],
    description:
      "'team' — every task on engagements I manage or am the partner on (needs engagement.manage).",
  })
  @IsOptional()
  @IsIn(['mine', 'team'])
  scope?: 'mine' | 'team';
}
