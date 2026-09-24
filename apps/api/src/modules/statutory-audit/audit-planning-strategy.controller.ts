import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type AcceptanceCarryForwardRecord,
  type PlanningConsiderationRecord,
  type PlanningDiscussionRecord,
  type PlanningMatterRecord,
  type PriorYearMatterRecord,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditPlanningStrategyService } from './audit-planning-strategy.service';
import {
  AssessPlanningConsiderationDto,
  AssessPriorYearMatterDto,
  ConcludeAcceptanceMatterDto,
  CreatePlanningConsiderationDto,
  CreatePlanningMatterDto,
  CreatePriorYearMatterDto,
  UpdatePlanningDiscussionDto,
  UpdatePlanningMatterDto,
} from './dto/planning-strategy.dto';

/**
 * Statutory Audit — 03.1 remaining sub-sections: strategic timing/resource
 * considerations, prior-year intelligence, acceptance carry-forward, the team
 * planning discussion and the Planning Matter register. Reads gated by
 * `engagement.read`, mutations by `engagement.manage`; RLS does the real gating.
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditPlanningStrategyController {
  constructor(private readonly strategy: AuditPlanningStrategyService) {}

  // ── §13.2–13.3 Strategic considerations ────────────────────────────────────

  @Get(':id/statutory-audit/:workflowInstanceId/planning-considerations')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Strategic timing / resource considerations (03.1 §13)' })
  listConsiderations(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<PlanningConsiderationRecord[]> {
    return this.strategy.listConsiderations(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/planning-considerations')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Add a Manager timing / resource consideration' })
  createConsideration(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: CreatePlanningConsiderationDto,
  ): Promise<PlanningConsiderationRecord> {
    return this.strategy.createConsideration(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/planning-considerations/:considerationId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Assess a timing / resource consideration' })
  assessConsideration(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('considerationId', new ParseUUIDPipe()) considerationId: string,
    @Body() dto: AssessPlanningConsiderationDto,
  ): Promise<PlanningConsiderationRecord> {
    return this.strategy.assessConsideration(
      rlsContextFromPrincipal(principal),
      id,
      considerationId,
      dto,
    );
  }

  // ── 03.1.6 Prior-year intelligence ─────────────────────────────────────────

  @Get(':id/statutory-audit/:workflowInstanceId/prior-year-matters')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Prior-year matters (03.1.6)' })
  listPriorYear(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<PriorYearMatterRecord[]> {
    return this.strategy.listPriorYear(rlsContextFromPrincipal(principal), id, workflowInstanceId);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/prior-year-matters')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Add a prior-year matter with source evidence' })
  createPriorYear(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: CreatePriorYearMatterDto,
  ): Promise<PriorYearMatterRecord> {
    return this.strategy.createPriorYear(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/prior-year-matters/:matterId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Reassess a prior-year matter for the current year' })
  assessPriorYear(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('matterId', new ParseUUIDPipe()) matterId: string,
    @Body() dto: AssessPriorYearMatterDto,
  ): Promise<PriorYearMatterRecord> {
    return this.strategy.assessPriorYear(rlsContextFromPrincipal(principal), id, matterId, dto);
  }

  // ── 03.1.7 Acceptance matters carried forward ──────────────────────────────

  @Get(':id/statutory-audit/:workflowInstanceId/acceptance-carry-forward')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Unresolved / conditional Section 01 matters to carry forward (03.1.7)',
  })
  listAcceptance(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<AcceptanceCarryForwardRecord[]> {
    return this.strategy.listAcceptance(rlsContextFromPrincipal(principal), id, workflowInstanceId);
  }

  @Post(':id/statutory-audit/acceptance-carry-forward/:matterId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Convert, link or conclude an acceptance matter' })
  concludeAcceptance(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('matterId', new ParseUUIDPipe()) matterId: string,
    @Body() dto: ConcludeAcceptanceMatterDto,
  ): Promise<AcceptanceCarryForwardRecord> {
    return this.strategy.concludeAcceptance(rlsContextFromPrincipal(principal), id, matterId, dto);
  }

  // ── 03.1.8 Team planning discussion ────────────────────────────────────────

  @Get(':id/statutory-audit/:workflowInstanceId/planning-discussion')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Initial engagement-team planning discussion (03.1.8)' })
  getDiscussion(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<PlanningDiscussionRecord> {
    return this.strategy.getDiscussion(rlsContextFromPrincipal(principal), id, workflowInstanceId);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/planning-discussion')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Record / update the team planning discussion' })
  saveDiscussion(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: UpdatePlanningDiscussionDto,
  ): Promise<PlanningDiscussionRecord> {
    return this.strategy.saveDiscussion(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  // ── §18 Planning Matter / Action register ──────────────────────────────────

  @Get(':id/statutory-audit/:workflowInstanceId/planning-matters')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Planning Matter / Action register (03.1 §18)' })
  listMatters(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<PlanningMatterRecord[]> {
    return this.strategy.listMatters(rlsContextFromPrincipal(principal), id, workflowInstanceId);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/planning-matters')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Raise a Planning Matter / Action' })
  createMatter(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: CreatePlanningMatterDto,
  ): Promise<PlanningMatterRecord> {
    return this.strategy.createMatter(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/planning-matters/:matterId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update a Planning Matter (resolution required on closure)' })
  updateMatter(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('matterId', new ParseUUIDPipe()) matterId: string,
    @Body() dto: UpdatePlanningMatterDto,
  ): Promise<PlanningMatterRecord> {
    return this.strategy.updateMatter(rlsContextFromPrincipal(principal), id, matterId, dto);
  }
}
