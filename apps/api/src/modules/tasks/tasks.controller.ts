import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type Paginated } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { TasksService } from './tasks.service';
import type { TaskDetail, TaskRecord } from './tasks.types';
import {
  AddDependencyDto,
  CreateTaskDto,
  TaskListQueryDto,
  UpdateTaskDto,
  UpdateTaskStatusDto,
} from './dto/task.dto';

/**
 * Engagement tasks (Phase 9). Reads need `engagement.read`; create/assign/
 * dependency management need `engagement.manage` (leads); a task's status may be
 * progressed with `task.update` (the assignee — RLS enforces assignee-or-lead).
 */
@ApiTags('engagement-tasks')
@Controller('engagements')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get(':id/tasks')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'List engagement tasks (paginated); filter ?status=&assignedToEmployeeId=',
  })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: TaskListQueryDto,
  ): Promise<Paginated<TaskRecord>> {
    const filter: { status?: TaskListQueryDto['status']; assignedToEmployeeId?: string } = {};
    if (query.status) filter.status = query.status;
    if (query.assignedToEmployeeId) filter.assignedToEmployeeId = query.assignedToEmployeeId;
    return this.tasks
      .list(rlsContextFromPrincipal(principal), id, query, filter)
      .then((result) => paginate(result, query));
  }

  @Get(':id/tasks/:taskId')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Get a task with its blockers (dependencies)' })
  getOne(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
  ): Promise<TaskDetail> {
    return this.tasks.getOne(rlsContextFromPrincipal(principal), id, taskId);
  }

  @Post(':id/tasks')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Create a task (audited)' })
  create(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateTaskDto,
  ): Promise<TaskRecord> {
    return this.tasks.create(rlsContextFromPrincipal(principal), id, dto);
  }

  @Patch(':id/tasks/:taskId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update task fields incl. assignee/due (audited; lead only)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body() dto: UpdateTaskDto,
  ): Promise<TaskRecord> {
    return this.tasks.update(rlsContextFromPrincipal(principal), id, taskId, dto);
  }

  @Post(':id/tasks/:taskId/status')
  @RequirePermissions(PERMISSION.taskUpdate)
  @ApiOperation({
    summary: 'Progress a task’s status (audited)',
    description:
      'The assignee or an engagement lead. A task cannot be marked done while it still has an ' +
      'unfinished blocker.',
  })
  updateStatus(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body() dto: UpdateTaskStatusDto,
  ): Promise<TaskRecord> {
    return this.tasks.updateStatus(rlsContextFromPrincipal(principal), id, taskId, dto);
  }

  @Post(':id/tasks/:taskId/dependencies')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Add a blocker: this task depends on another (audited; rejects cycles)',
  })
  addDependency(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body() dto: AddDependencyDto,
  ): Promise<TaskDetail> {
    return this.tasks.addDependency(
      rlsContextFromPrincipal(principal),
      id,
      taskId,
      dto.dependsOnTaskId,
    );
  }

  @Delete(':id/tasks/:taskId/dependencies/:dependencyId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Remove a task dependency (audited)' })
  removeDependency(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Param('dependencyId', new ParseUUIDPipe()) dependencyId: string,
  ): Promise<TaskDetail> {
    return this.tasks.removeDependency(
      rlsContextFromPrincipal(principal),
      id,
      taskId,
      dependencyId,
    );
  }
}
