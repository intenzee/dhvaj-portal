import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type Paginated } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { TasksService } from './tasks.service';
import { ClientDependenciesService } from './client-dependencies.service';
import type { ClientDependencyWithContext, MyTaskRecord } from './tasks.types';
import { MyTasksQueryDto } from './dto/task.dto';
import { MyClientDependenciesQueryDto } from './dto/client-dependency.dto';

/**
 * Firm-wide "My Work" views (Phase 9), RLS-scoped to what the caller can see —
 * the tasks assigned to them and the client dependencies they're waiting on,
 * across every engagement. The data behind the My Work / Client Dependencies
 * navigation and dashboard cards.
 */
@ApiTags('work')
@Controller('work')
export class WorkController {
  constructor(
    private readonly tasks: TasksService,
    private readonly deps: ClientDependenciesService,
  ) {}

  @Get('tasks')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Tasks assigned to me across all engagements (paginated)',
    description: 'Filter ?status= and ?overdueOnly=true (internally-overdue work).',
  })
  myTasks(
    @CurrentPrincipal() principal: Principal,
    @Query() query: MyTasksQueryDto,
  ): Promise<Paginated<MyTaskRecord>> {
    const filter: { status?: MyTasksQueryDto['status']; overdueOnly?: boolean } = {};
    if (query.status) filter.status = query.status;
    if (query.overdueOnly !== undefined) filter.overdueOnly = query.overdueOnly;
    return this.tasks
      .myTasks(rlsContextFromPrincipal(principal), query, filter)
      .then((result) => paginate(result, query));
  }

  @Get('client-dependencies')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Open client dependencies across all engagements I can see (paginated)',
    description: 'Filter ?overdueOnly=true (past escalation date — a client delay).',
  })
  clientDependencies(
    @CurrentPrincipal() principal: Principal,
    @Query() query: MyClientDependenciesQueryDto,
  ): Promise<Paginated<ClientDependencyWithContext>> {
    const filter: { overdueOnly?: boolean } = {};
    if (query.overdueOnly !== undefined) filter.overdueOnly = query.overdueOnly;
    return this.deps
      .mine(rlsContextFromPrincipal(principal), query, filter)
      .then((result) => paginate(result, query));
  }
}
