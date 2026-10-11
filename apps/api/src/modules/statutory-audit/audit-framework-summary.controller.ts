import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type StatutoryAuditFrameworkSummary } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditFrameworkSummaryService } from './audit-framework-summary.service';
import {
  ApproveFrameworkDto,
  ConfirmFrameworkDto,
  ReopenFrameworkDto,
  ResolveFrameworkItemDto,
} from './dto/framework-summary.dto';

/**
 * Statutory Audit — 02.8 Audit Framework Summary & Approval endpoints. Reads
 * gated by `engagement.read`, mutations by `engagement.manage`; the service
 * enforces the roles (AF-01 / reopen: engagement lead; AF-02: the Engagement
 * Partner only) and RLS does the row gating.
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditFrameworkSummaryController {
  constructor(private readonly summary: AuditFrameworkSummaryService) {}

  @Get(':id/statutory-audit/framework-summary')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "An engagement's 02.8 framework summary + approval state" })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StatutoryAuditFrameworkSummary[]> {
    return this.summary.listForEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/framework-summary/confirm')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'AF-01 — Manager review: submit for Partner approval or return' })
  confirm(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: ConfirmFrameworkDto,
  ): Promise<StatutoryAuditFrameworkSummary> {
    return this.summary.confirmManager(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      decision: dto.decision,
      note: dto.note,
      previewReviewed: dto.previewReviewed,
      returnItems: dto.returnItems,
      recordVersion: dto.recordVersion,
    });
  }

  @Post(':id/statutory-audit/:workflowInstanceId/framework-summary/approve')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'AF-02 — Engagement Partner: approve, approve subject to conditions, or return',
  })
  approve(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: ApproveFrameworkDto,
  ): Promise<StatutoryAuditFrameworkSummary> {
    return this.summary.approve(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      decision: dto.decision,
      methodologyVersion: dto.methodologyVersion,
      conditions: dto.conditions,
      returnReason: dto.returnReason,
      returnSections: dto.returnSections,
      recordVersion: dto.recordVersion,
    });
  }

  @Post(':id/statutory-audit/:workflowInstanceId/framework-summary/reopen')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Controlled reopen (§15) — preserves the approved baseline, opens the next version',
  })
  reopen(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: ReopenFrameworkDto,
  ): Promise<StatutoryAuditFrameworkSummary> {
    return this.summary.reopen(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      reason: dto.reason,
      affectedSections: dto.affectedSections,
      identifiedAt: dto.identifiedAt,
      identifiedByEmployeeId: dto.identifiedByEmployeeId,
      evidenceNote: dto.evidenceNote,
      evidenceDocumentId: dto.evidenceDocumentId,
      reapprovalRequired: dto.reapprovalRequired,
      recordVersion: dto.recordVersion,
    });
  }

  @Post(':id/statutory-audit/framework-summary/returns/:returnId/resolve')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Clear an AF-01 / AF-02 returned item (owner or lead)' })
  resolveReturn(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('returnId', new ParseUUIDPipe()) returnId: string,
    @Body() dto: ResolveFrameworkItemDto,
  ): Promise<StatutoryAuditFrameworkSummary> {
    return this.summary.resolveReturn(rlsContextFromPrincipal(principal), id, returnId, {
      resolution: dto.resolution,
    });
  }

  @Post(':id/statutory-audit/framework-summary/conditions/:conditionId/resolve')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Resolve an approval condition (owner or lead)' })
  resolveCondition(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('conditionId', new ParseUUIDPipe()) conditionId: string,
    @Body() dto: ResolveFrameworkItemDto,
  ): Promise<StatutoryAuditFrameworkSummary> {
    return this.summary.resolveCondition(rlsContextFromPrincipal(principal), id, conditionId, {
      resolution: dto.resolution,
    });
  }
}
