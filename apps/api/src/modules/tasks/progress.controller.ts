import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  PROGRESS_GROUP,
  type Paginated,
  type ProgressItem,
  type ProgressView,
  type TaskTimeline,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { ProgressService } from './progress.service';
import { ProgressItemsQueryDto, ProgressQueryDto } from './dto/progress.dto';

/**
 * Phase 3, D-1 — the Progress tracker: counts of not started / in progress /
 * completed (and overdue) work for a period, by person, client or filing, with
 * the drill-down list the counts add up to and each task's timeline. Scoped to
 * the firm (Managing Partner, administrator) or the caller's reporting tree.
 */
@ApiTags('work')
@Controller('work/progress')
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  @Get()
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Progress counts by person, client or filing (D-1)',
    description:
      '?groupBy=person|client|filing (default person). ?from= / ?to= bound the internal due date ' +
      '(inclusive); ?officeId=, ?stream= (a stream or statutory_audit / assignment), ?teamId= (the ' +
      "client's team). Cancelled work is left out. Overdue = open work past its internal date (IST). " +
      'Rows: overdue first, then the most open work.',
  })
  view(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ProgressQueryDto,
  ): Promise<ProgressView> {
    const { groupBy, ...filters } = query;
    return this.progress.view(
      rlsContextFromPrincipal(principal),
      groupBy ?? PROGRESS_GROUP.person,
      filters,
    );
  }

  @Get('items')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'The tasks behind a progress row (paginated)',
    description:
      "The view's filters plus ?groupBy= and ?key= (a row's key), ?progress=not_started|in_progress|" +
      'completed and ?overdueOnly=true. Overdue first, then by internal date.',
  })
  async items(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ProgressItemsQueryDto,
  ): Promise<Paginated<ProgressItem>> {
    const { limit, offset, ...q } = query;
    const result = await this.progress.items(rlsContextFromPrincipal(principal), q, {
      limit,
      offset,
    });
    return paginate(result, query);
  }

  @Get('tasks/:taskId/timeline')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: "A task's timeline",
    description:
      'Created, assigned (by, to), started, sent for review, sent back, approved, filed — each with ' +
      'who and when, oldest first.',
  })
  timeline(
    @CurrentPrincipal() principal: Principal,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
  ): Promise<TaskTimeline> {
    return this.progress.timeline(rlsContextFromPrincipal(principal), taskId);
  }
}
