import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type AreaOfFocusRecord,
  type PlanningChangeRecord,
  type PlanningIntelligenceSummary,
  type PlanningSignalRecord,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditPlanningIntelligenceService } from './audit-planning-intelligence.service';
import {
  AssessPlanningSignalDto,
  CreateAreaOfFocusDto,
  CreatePlanningChangeDto,
  CreatePlanningSignalDto,
  UpdateAreaOfFocusDto,
  UpdatePlanningChangeDto,
  UpdatePlanningIntelligenceDto,
} from './dto/planning-intelligence.dto';

/**
 * Statutory Audit — 03.1 Planning Intelligence & the Planning Signal Register.
 * Reads gated by `engagement.read`, mutations by `engagement.manage`; RLS does
 * the real gating (members read; EP/manager leads mutate).
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditPlanningIntelligenceController {
  constructor(private readonly intelligence: AuditPlanningIntelligenceService) {}

  // ── 03.1 record / control room ─────────────────────────────────────────────

  @Get(':id/statutory-audit/:workflowInstanceId/planning-intelligence')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: '03.1 control-room summary (record + signal/focus counts)' })
  summary(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<PlanningIntelligenceSummary> {
    return this.intelligence.getSummary(rlsContextFromPrincipal(principal), id, workflowInstanceId);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/planning-intelligence/generate')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Generate Engagement Intelligence signals from Section 01/02 facts',
    description: 'Idempotent: upserts by rule; never overwrites Manager assessments.',
  })
  generate(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<PlanningIntelligenceSummary> {
    return this.intelligence.generateIntelligence(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/planning-intelligence')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update 03.1 — AS-01 orientation, AS-02 scope, summary, status' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: UpdatePlanningIntelligenceDto,
  ): Promise<PlanningIntelligenceSummary> {
    return this.intelligence.updateIntelligence(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/planning-intelligence/strategy-draft')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Draft the Strategy Summary from structured data (not persisted)' })
  strategyDraft(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<{ draft: string }> {
    return this.intelligence.draftStrategySummary(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
    );
  }

  // ── Planning Signal Register ───────────────────────────────────────────────

  @Get(':id/statutory-audit/:workflowInstanceId/planning-signals')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'The Planning Signal Register for an audit file' })
  listSignals(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<PlanningSignalRecord[]> {
    return this.intelligence.listSignals(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/planning-signals')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Raise a Manager / Partner / prior-year Planning Signal' })
  createSignal(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: CreatePlanningSignalDto,
  ): Promise<PlanningSignalRecord> {
    return this.intelligence.createSignal(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/planning-signals/:signalId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Assess a Planning Signal in place' })
  assessSignal(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('signalId', new ParseUUIDPipe()) signalId: string,
    @Body() dto: AssessPlanningSignalDto,
  ): Promise<PlanningSignalRecord> {
    return this.intelligence.assessSignal(rlsContextFromPrincipal(principal), id, signalId, dto);
  }

  // ── Areas of Focus ─────────────────────────────────────────────────────────

  @Get(':id/statutory-audit/:workflowInstanceId/areas-of-focus')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Manager Areas of Focus' })
  listFocus(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<AreaOfFocusRecord[]> {
    return this.intelligence.listFocusAreas(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/areas-of-focus')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Create an Area of Focus grouping signals' })
  createFocus(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: CreateAreaOfFocusDto,
  ): Promise<AreaOfFocusRecord> {
    return this.intelligence.createFocusArea(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/areas-of-focus/:focusId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update an Area of Focus (and its linked signals)' })
  updateFocus(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('focusId', new ParseUUIDPipe()) focusId: string,
    @Body() dto: UpdateAreaOfFocusDto,
  ): Promise<AreaOfFocusRecord> {
    return this.intelligence.updateFocusArea(rlsContextFromPrincipal(principal), id, focusId, dto);
  }

  // ── 03.1.2 Significant changes (PI-01) ─────────────────────────────────────

  @Get(':id/statutory-audit/:workflowInstanceId/planning-changes')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Significant current-year changes (PI-01)' })
  listChanges(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<PlanningChangeRecord[]> {
    return this.intelligence.listChanges(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/planning-changes')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Record a significant current-year change (PI-01)' })
  createChange(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: CreatePlanningChangeDto,
  ): Promise<PlanningChangeRecord> {
    return this.intelligence.createChange(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/planning-changes/:changeId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update a significant change (optionally generate its signal)' })
  updateChange(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('changeId', new ParseUUIDPipe()) changeId: string,
    @Body() dto: UpdatePlanningChangeDto,
  ): Promise<PlanningChangeRecord> {
    return this.intelligence.updateChange(rlsContextFromPrincipal(principal), id, changeId, dto);
  }
}
