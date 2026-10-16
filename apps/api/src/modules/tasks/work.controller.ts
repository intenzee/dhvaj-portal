import { Controller, ForbiddenException, Get, NotFoundException, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FEATURE_FLAG,
  PERMISSION,
  type Paginated,
  type TodayView,
  type WorkReviewQueue,
} from '@hsdg/contracts';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { TasksService } from './tasks.service';
import { ClientDependenciesService } from './client-dependencies.service';
import { WorkReviewsService } from './work-reviews.service';
import { WorkTodayService } from './work-today.service';
import type { ClientDependencyWithContext, MyTaskRecord } from './tasks.types';
import { MyTasksQueryDto, TodayQueryDto } from './dto/task.dto';
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
    private readonly reviews: WorkReviewsService,
    private readonly todayView: WorkTodayService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get('today')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: "Today: the caller's day in groups (WF-201, PS-102)",
    description:
      'prepare (my todo / in_progress / paused tasks), review (the GET /work/reviews queue), ' +
      'waiting (my blocked tasks + open client requests I am responsible for), due_soon (open ' +
      'filings I prepare, review or lead due internally within 7 days or past, with or without ' +
      'a task, less those listed above), notices (open notices I own or review, by their clock ' +
      'date — only when ff_notices is on), write_offs (write-offs and credit notes others asked ' +
      'for on clients I bill — only with ff_billing_v2 and billing.approve). Each group is overdue first, then by internal date. ' +
      '?engagementId= narrows every group to one engagement. Behind ff_today_view.',
  })
  today(
    @CurrentPrincipal() principal: Principal,
    @Query() query: TodayQueryDto,
  ): Promise<TodayView> {
    if (!this.flags.isOnFor(FEATURE_FLAG.todayView, principal.officeCode)) {
      throw new NotFoundException('Today is not switched on for your office yet.');
    }
    return this.todayView.today(rlsContextFromPrincipal(principal), query.engagementId, {
      notices: this.flags.isOnFor(FEATURE_FLAG.notices, principal.officeCode),
      writeOffs:
        this.flags.isOnFor(FEATURE_FLAG.billing, principal.officeCode) &&
        principal.permissions.includes(PERMISSION.billingApprove),
    });
  }

  @Get('tasks')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Tasks assigned to me across all engagements (paginated)',
    description:
      'Filter ?status=, ?overdueOnly=true (internally-overdue work) and ?section=gst,income_tax ' +
      "(a stream via the task's engagement service; statutory_audit / assignment via the engagement). " +
      '?scope=team lists every task on engagements I manage or am the partner on (engagement.manage). ' +
      "Each row carries `link` (a WorkItemRef) and, for a filing's task, `filing`.",
  })
  myTasks(
    @CurrentPrincipal() principal: Principal,
    @Query() query: MyTasksQueryDto,
  ): Promise<Paginated<MyTaskRecord>> {
    if (query.scope === 'team' && !principal.permissions.includes(PERMISSION.engagementManage)) {
      throw new ForbiddenException('The team view is for engagement leads (engagement.manage).');
    }
    const filter: Parameters<TasksService['myTasks']>[2] = {};
    if (query.scope) filter.scope = query.scope;
    if (query.status) filter.status = query.status;
    if (query.overdueOnly !== undefined) filter.overdueOnly = query.overdueOnly;
    if (query.section?.length) filter.sections = query.section;
    return this.tasks
      .myTasks(rlsContextFromPrincipal(principal), query, filter)
      .then((result) => paginate(result, query));
  }

  @Get('client-dependencies')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Open client dependencies across all engagements I can see (paginated)',
    description:
      'Filter ?overdueOnly=true (past escalation date — a client delay). Each row carries ' +
      '`link` (a WorkItemRef: the filing with requestId, else the engagement).',
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

  @Get('reviews')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Everything waiting for my review, oldest first (WF-105)',
    description:
      'filing_review: tasks sent to me for review (reviewer = me, status in_review); ' +
      'review_point: open review points on active engagements I manage (or partner with no ' +
      'manager); sign_off: active engagements I partner whose review model needs EP sign-off, ' +
      'cleared at review with no open points. Each item carries `link` (a WorkItemRef).',
  })
  reviewQueue(@CurrentPrincipal() principal: Principal): Promise<WorkReviewQueue> {
    return this.reviews.queue(rlsContextFromPrincipal(principal));
  }

  @Get('reviews/count')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'How many items are waiting for my review (the sidebar badge)' })
  reviewCount(@CurrentPrincipal() principal: Principal): Promise<{ total: number }> {
    return this.reviews.count(rlsContextFromPrincipal(principal));
  }
}
