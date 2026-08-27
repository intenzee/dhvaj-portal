import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  LIFECYCLE_ACTION,
  PERMISSION,
  type LifecycleAction,
  type Paginated,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { PaginationQueryDto, paginate } from '../../common/pagination/pagination.dto';
import { EngagementsService } from './engagements.service';
import { EngagementLifecycleService } from './lifecycle/engagement-lifecycle.service';
import { EngagementWorkflowService } from './lifecycle/engagement-workflow.service';
import type {
  EngagementDetail,
  EngagementFilter,
  EngagementSummary,
  LifecycleHistoryRecord,
} from './engagements.types';
import { CreateEngagementDto } from './dto/create-engagement.dto';
import { UpdateEngagementDto } from './dto/update-engagement.dto';
import { AddServiceDto } from './dto/add-service.dto';
import { EngagementListQueryDto } from './dto/engagement-list-query.dto';
import { AssignTeamMemberDto, ReassignPartnerDto } from './dto/engagement-commands.dto';
import {
  LifecycleTransitionDto,
  PutOnHoldDto,
  ReopenEngagementDto,
  WorkflowTransitionDto,
} from './dto/lifecycle-transition.dto';

@ApiTags('engagements')
@Controller('engagements')
export class EngagementsController {
  constructor(
    private readonly engagements: EngagementsService,
    private readonly lifecycle: EngagementLifecycleService,
    private readonly workflow: EngagementWorkflowService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'List engagements the caller can access (paginated)',
    description:
      'RLS-scoped to assignment (EP / manager / team), independent of office. Firm-wide roles see all. Filter by status/entity/service/office or ?mine=true.',
  })
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: EngagementListQueryDto,
  ): Promise<Paginated<EngagementSummary>> {
    const filter: EngagementFilter = {};
    if (query.status) filter.status = query.status;
    if (query.entityId) filter.entityId = query.entityId;
    if (query.serviceCode) filter.serviceCode = query.serviceCode;
    if (query.officeCode) filter.officeCode = query.officeCode;
    if (query.mine !== undefined) filter.mine = query.mine;
    if (query.search) filter.search = query.search;
    const result = await this.engagements.listEngagements(
      rlsContextFromPrincipal(principal),
      filter,
      query,
    );
    return paginate(result, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Get an engagement with its team',
    description: '404 unless the caller is assigned (or firm-wide) — scope is not leaked.',
  })
  async getById(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<EngagementDetail> {
    const engagement = await this.engagements.getEngagementById(
      rlsContextFromPrincipal(principal),
      id,
    );
    if (!engagement) throw new NotFoundException('Engagement not found.');
    return engagement;
  }

  @Post()
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Create an engagement (audited)' })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateEngagementDto,
  ): Promise<EngagementDetail> {
    return this.engagements.createEngagement(rlsContextFromPrincipal(principal), dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update an engagement (audited; optimistic concurrency)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateEngagementDto,
  ): Promise<EngagementDetail> {
    return this.engagements.updateEngagement(rlsContextFromPrincipal(principal), id, dto);
  }

  @Post(':id/reassign-partner')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Change the accountable Engagement Partner (audited)',
    description: 'Changing accountability requires firm-wide authority.',
  })
  reassignPartner(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReassignPartnerDto,
  ): Promise<EngagementDetail> {
    return this.engagements.reassignPartner(
      rlsContextFromPrincipal(principal),
      id,
      dto.engagementPartnerEmployeeId,
      dto.reason,
      dto.version,
    );
  }

  @Post(':id/team')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Assign a team member (audited)' })
  assignTeam(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssignTeamMemberDto,
  ): Promise<EngagementDetail> {
    return this.engagements.assignTeamMember(rlsContextFromPrincipal(principal), id, dto);
  }

  @Delete(':id/team/:employeeId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Remove a team member (audited)' })
  removeTeam(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
  ): Promise<EngagementDetail> {
    return this.engagements.removeTeamMember(rlsContextFromPrincipal(principal), id, employeeId);
  }

  // ── Services (multi-service engagements, §9–§10) ─────────────────────────

  @Get(':id/services')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'List the service lines carried by an engagement' })
  async listServices(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const detail = await this.engagements.getEngagementById(rlsContextFromPrincipal(principal), id);
    if (!detail) throw new NotFoundException('Engagement not found.');
    return detail.services;
  }

  @Post(':id/services')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Add a service line to an engagement (audited)' })
  addService(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddServiceDto,
  ): Promise<EngagementDetail> {
    return this.engagements.addService(rlsContextFromPrincipal(principal), id, dto);
  }

  @Delete(':id/services/:serviceLineId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Remove (soft-cancel) a service line from an engagement (audited)' })
  removeService(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('serviceLineId', new ParseUUIDPipe()) serviceLineId: string,
  ): Promise<EngagementDetail> {
    return this.engagements.removeService(rlsContextFromPrincipal(principal), id, serviceLineId);
  }

  // ── Lifecycle (Phase 6): explicit, guarded transitions — never a generic
  // "set status" endpoint. Each maps to exactly one hsdg.engagement_lifecycle_
  // transitions action; see EngagementLifecycleService for the shared
  // orchestration (validate → guard → version-checked mutate → history → audit).

  @Get(':id/lifecycle-history')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: "The engagement's lifecycle history (its business journey)",
    description: 'Distinct from /audit — this is status transitions only, in order.',
  })
  lifecycleHistory(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<LifecycleHistoryRecord>> {
    return this.lifecycle
      .listHistory(rlsContextFromPrincipal(principal), id, query)
      .then((result) => paginate(result, query));
  }

  private runTransition(
    action: LifecycleAction,
    principal: Principal,
    id: string,
    dto: LifecycleTransitionDto | PutOnHoldDto | ReopenEngagementDto,
  ): Promise<EngagementDetail> {
    return this.lifecycle.transition(rlsContextFromPrincipal(principal), id, action, dto);
  }

  @Post(':id/submit-for-acceptance')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Submit a prospect for acceptance (audited)' })
  submitForAcceptance(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: LifecycleTransitionDto,
  ): Promise<EngagementDetail> {
    return this.runTransition(LIFECYCLE_ACTION.submitForAcceptance, principal, id, dto);
  }

  @Post(':id/accept')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Accept the engagement (audited)',
    description: 'Requires an accountable Engagement Partner already assigned.',
  })
  accept(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: LifecycleTransitionDto,
  ): Promise<EngagementDetail> {
    return this.runTransition(LIFECYCLE_ACTION.accept, principal, id, dto);
  }

  @Post(':id/start')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Start the engagement (audited)',
    description: "Initialises the service workflow at the service's configured initial state.",
  })
  start(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: LifecycleTransitionDto,
  ): Promise<EngagementDetail> {
    return this.runTransition(LIFECYCLE_ACTION.start, principal, id, dto);
  }

  @Post(':id/put-on-hold')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Put the engagement on hold (audited; reason required)' })
  putOnHold(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PutOnHoldDto,
  ): Promise<EngagementDetail> {
    return this.runTransition(LIFECYCLE_ACTION.putOnHold, principal, id, dto);
  }

  @Post(':id/resume')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Resume a held engagement (audited)',
    description:
      'Returns to the operational status recorded when the hold began — not always "active".',
  })
  resume(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: LifecycleTransitionDto,
  ): Promise<EngagementDetail> {
    return this.runTransition(LIFECYCLE_ACTION.resume, principal, id, dto);
  }

  @Post(':id/complete')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Mark the engagement complete (audited)',
    description: 'Requires the service workflow to have reached its terminal state.',
  })
  complete(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: LifecycleTransitionDto,
  ): Promise<EngagementDetail> {
    return this.runTransition(LIFECYCLE_ACTION.complete, principal, id, dto);
  }

  @Post(':id/close')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Close a completed engagement (audited)' })
  close(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: LifecycleTransitionDto,
  ): Promise<EngagementDetail> {
    return this.runTransition(LIFECYCLE_ACTION.close, principal, id, dto);
  }

  @Post(':id/decline')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Decline a pending-acceptance engagement (audited)' })
  decline(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: LifecycleTransitionDto,
  ): Promise<EngagementDetail> {
    return this.runTransition(LIFECYCLE_ACTION.decline, principal, id, dto);
  }

  @Post(':id/withdraw')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Withdraw an accepted or active engagement (audited)' })
  withdraw(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: LifecycleTransitionDto,
  ): Promise<EngagementDetail> {
    return this.runTransition(LIFECYCLE_ACTION.withdraw, principal, id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Cancel a prospect or pending-acceptance engagement (audited)' })
  cancel(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: LifecycleTransitionDto,
  ): Promise<EngagementDetail> {
    return this.runTransition(LIFECYCLE_ACTION.cancel, principal, id, dto);
  }

  @Post(':id/reopen')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Reopen a completed or closed engagement (audited)',
    description: 'Managing-Partner-only governance action; reason required.',
  })
  reopen(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReopenEngagementDto,
  ): Promise<EngagementDetail> {
    return this.runTransition(LIFECYCLE_ACTION.reopen, principal, id, dto);
  }

  // ── Service workflow (Phase 6 foundation, §16-19): independent of lifecycle.

  @Post(':id/workflow-transitions')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Advance the service-workflow state (audited)',
    description:
      'Distinct from the engagement lifecycle — moves hsdg.engagements.current_workflow_state_id ' +
      'along the configured hsdg.workflow_transitions for the service’s workflow family. Requires the ' +
      'engagement to be "active" and the workflow already started (see POST .../start).',
  })
  advanceWorkflow(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: WorkflowTransitionDto,
  ): Promise<EngagementDetail> {
    return this.workflow.advance(rlsContextFromPrincipal(principal), id, dto);
  }
}
