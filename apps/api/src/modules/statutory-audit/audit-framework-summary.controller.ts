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
} from './dto/framework-summary.dto';

/**
 * Statutory Audit — 02.8 Audit Framework Summary & Approval endpoints (Guide
 * §9.8, §13). Reads gated by `engagement.read`, mutations by `engagement.manage`;
 * RLS does the real gating (members read; only leads mutate the audit file).
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
  @ApiOperation({ summary: 'AF-01 — Manager confirmation of the audit framework' })
  confirm(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: ConfirmFrameworkDto,
  ): Promise<StatutoryAuditFrameworkSummary> {
    return this.summary.confirmManager(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      note: dto.note,
      recordVersion: dto.recordVersion,
    });
  }

  @Post(':id/statutory-audit/:workflowInstanceId/framework-summary/approve')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'AF-02 — Engagement Partner approval; freezes the baseline & unlocks Planning',
  })
  approve(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: ApproveFrameworkDto,
  ): Promise<StatutoryAuditFrameworkSummary> {
    return this.summary.approve(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      methodologyVersion: dto.methodologyVersion,
      recordVersion: dto.recordVersion,
    });
  }

  @Post(':id/statutory-audit/:workflowInstanceId/framework-summary/reopen')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Controlled reopen (§13) — preserves the approved baseline, opens the next version',
  })
  reopen(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: ReopenFrameworkDto,
  ): Promise<StatutoryAuditFrameworkSummary> {
    return this.summary.reopen(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      reason: dto.reason,
      recordVersion: dto.recordVersion,
    });
  }
}
