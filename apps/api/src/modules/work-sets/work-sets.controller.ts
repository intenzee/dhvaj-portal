import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type AssignableTask,
  type SplitWorkSetResult,
  type WorkSetDetail,
  type WorkSetPerson,
  type WorkSetSummary,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import {
  CreateWorkSetDto,
  OpenTasksQueryDto,
  SplitWorkSetDto,
  WorkSetPeopleQueryDto,
  WorkSetsQueryDto,
} from './dto/work-sets.dto';
import { WorkSetsService } from './work-sets.service';

/**
 * Assign work (Phase 2, C-3) and splitting a set (C-4). Giving a set is for a
 * Manager and above (the service checks the main role and the reporting line);
 * anyone reads the sets given to them or by them.
 */
@ApiTags('work-sets')
@Controller('work-sets')
export class WorkSetsController {
  constructor(private readonly sets: WorkSetsService) {}

  @Get('people')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Who the caller may give work to',
    description:
      'A Manager: the people below them. A Partner, the Managing Partner or an administrator: anyone with the firm. ?below=true: the people below the caller, whoever they are (to split a set).',
  })
  people(
    @CurrentPrincipal() principal: Principal,
    @Query() query: WorkSetPeopleQueryDto,
  ): Promise<WorkSetPerson[]> {
    return this.sets.people(rlsContextFromPrincipal(principal), query.below === 'true');
  }

  @Get('open-tasks')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Open tasks the caller could hand on, with filters',
    description:
      'Tasks on engagements they lead or held by someone below them (all for the Managing Partner and an administrator). Manager and above.',
  })
  openTasks(
    @CurrentPrincipal() principal: Principal,
    @Query() query: OpenTasksQueryDto,
  ): Promise<AssignableTask[]> {
    return this.sets.openTasks(rlsContextFromPrincipal(principal), query);
  }

  @Get()
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Sets given to the caller (mine=assigned_to) or by them (mine=assigned_by)',
  })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: WorkSetsQueryDto,
  ): Promise<WorkSetSummary[]> {
    return this.sets.list(rlsContextFromPrincipal(principal), query.mine ?? 'assigned_to');
  }

  @Post()
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Give a set of tasks to one person (audited, one notification)',
    description:
      'The tasks move to them with the giver as reviewer; each move is kept in the task’s assignment history.',
  })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateWorkSetDto,
  ): Promise<WorkSetDetail> {
    return this.sets.create(rlsContextFromPrincipal(principal), dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'A set with its tasks and who holds each' })
  detail(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<WorkSetDetail> {
    return this.sets.detail(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/split')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Hand some of a set’s tasks to someone below the caller (audited)',
    description: 'They prepare, the caller reviews. One notification to them.',
  })
  split(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SplitWorkSetDto,
  ): Promise<SplitWorkSetResult> {
    return this.sets.split(rlsContextFromPrincipal(principal), id, dto);
  }
}
