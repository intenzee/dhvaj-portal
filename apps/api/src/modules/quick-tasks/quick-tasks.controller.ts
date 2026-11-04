import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PERMISSION,
  QUICK_TASK_STATUSES,
  type QuickTaskDetail,
  type QuickTaskInbox,
  type QuickTaskPerson,
  type QuickTaskStatus,
  type QuickTaskSummary,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { QuickTasksService, type QuickTaskBox } from './quick-tasks.service';

export class CreateQuickTaskDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() entityId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() engagementId?: string | null;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(500) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) details?: string | null;
  @ApiProperty() @IsUUID() assignedToEmployeeId!: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() urgent?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueAt?: string | null;
}

export class QuickTaskReplyDto {
  @ApiPropertyOptional({ enum: QUICK_TASK_STATUSES })
  @IsOptional()
  @IsIn(QUICK_TASK_STATUSES as unknown as string[])
  status?: QuickTaskStatus;
  @ApiPropertyOptional({ description: 'Minutes from now; -1 today, -2 tomorrow.' })
  @IsOptional()
  @IsInt()
  @Min(-2)
  @Max(20160)
  etaMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) body?: string;
}

class QuickTaskListQueryDto {
  @ApiPropertyOptional({ enum: ['inbox', 'sent', 'all'] })
  @IsOptional()
  @IsIn(['inbox', 'sent', 'all'])
  box?: QuickTaskBox;
  @ApiPropertyOptional({ enum: ['open', 'closed', 'all'] })
  @IsOptional()
  @IsIn(['open', 'closed', 'all'])
  state?: 'open' | 'closed' | 'all';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) q?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() engagementId?: string;
}

@ApiTags('quick-tasks')
@Controller('quick-tasks')
export class QuickTasksController {
  constructor(private readonly tasks: QuickTasksService) {}

  @Get('people')
  @RequirePermissions(PERMISSION.notificationRead)
  @ApiOperation({ summary: 'Everyone a quick task can go to' })
  people(@CurrentPrincipal() p: Principal): Promise<QuickTaskPerson[]> {
    return this.tasks.people(rlsContextFromPrincipal(p));
  }

  @Get('inbox')
  @RequirePermissions(PERMISSION.notificationRead)
  @ApiOperation({ summary: "The caller's unread count, and tasks given to them still unanswered" })
  inbox(@CurrentPrincipal() p: Principal): Promise<QuickTaskInbox> {
    return this.tasks.inbox(rlsContextFromPrincipal(p));
  }

  @Get()
  @RequirePermissions(PERMISSION.notificationRead)
  @ApiOperation({ summary: 'Quick tasks given to (inbox) or by (sent) the caller' })
  list(
    @CurrentPrincipal() p: Principal,
    @Query() q: QuickTaskListQueryDto,
  ): Promise<QuickTaskSummary[]> {
    return this.tasks.list(
      rlsContextFromPrincipal(p),
      q.box ?? 'all',
      q.state ?? 'all',
      q.q,
      q.engagementId,
    );
  }

  @Post()
  @RequirePermissions(PERMISSION.notificationRead)
  @ApiOperation({ summary: 'Give someone a quick task (they are notified at once)' })
  create(
    @CurrentPrincipal() p: Principal,
    @Body() dto: CreateQuickTaskDto,
  ): Promise<QuickTaskDetail> {
    return this.tasks.create(rlsContextFromPrincipal(p), dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.notificationRead)
  @ApiOperation({ summary: 'A quick task and its thread' })
  get(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<QuickTaskDetail> {
    return this.tasks.get(rlsContextFromPrincipal(p), id);
  }

  @Post(':id/read')
  @RequirePermissions(PERMISSION.notificationRead)
  @ApiOperation({ summary: "Mark the other person's messages seen" })
  read(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ read: number }> {
    return this.tasks.markRead(rlsContextFromPrincipal(p), id);
  }

  @Post(':id/reply')
  @RequirePermissions(PERMISSION.notificationRead)
  @ApiOperation({
    summary:
      'Answer: Received / Doing (done in …) / Done, a message, or the assigner cancels or reopens',
  })
  reply(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: QuickTaskReplyDto,
  ): Promise<QuickTaskDetail> {
    return this.tasks.reply(rlsContextFromPrincipal(p), id, dto);
  }
}
