import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type StatutoryAuditFramework } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditFrameworkService } from './audit-framework.service';
import {
  AddFrameworkEvidenceDto,
  ApproveFrameworkDto,
  FrameworkDecisionDto,
} from './dto/framework.dto';

/**
 * Statutory Audit — Framework (Phase 02) endpoints (Audit Spec §18–§20).
 * Reads are gated by `engagement.read`, mutations by `engagement.manage` — RLS
 * does the real gating (members read; only leads mutate the audit file).
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditFrameworkController {
  constructor(private readonly framework: AuditFrameworkService) {}

  @Get(':id/statutory-audit/framework')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "An engagement's statutory-audit framework assessments + approval" })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StatutoryAuditFramework[]> {
    return this.framework.listForEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/framework/run-suggestions')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Run the advisory applicability rule engine over the entity facts (§19)',
    description:
      'Updates only areas the professional has not decided; never overwrites a conclusion.',
  })
  runSuggestions(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<StatutoryAuditFramework> {
    return this.framework.runSuggestions(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
    );
  }

  @Post(':id/statutory-audit/framework/:assessmentId/decision')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Record the professional conclusion for a framework area (§19)' })
  decide(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('assessmentId', new ParseUUIDPipe()) assessmentId: string,
    @Body() dto: FrameworkDecisionDto,
  ): Promise<StatutoryAuditFramework> {
    return this.framework.recordDecision(rlsContextFromPrincipal(principal), id, assessmentId, {
      conclusion: dto.conclusion,
      basis: dto.basis,
      impact: dto.impact,
      version: dto.version,
    });
  }

  @Post(':id/statutory-audit/framework/:assessmentId/evidence')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Link evidence (an existing document or a note) to a framework area' })
  addEvidence(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('assessmentId', new ParseUUIDPipe()) assessmentId: string,
    @Body() dto: AddFrameworkEvidenceDto,
  ): Promise<StatutoryAuditFramework> {
    return this.framework.addEvidence(rlsContextFromPrincipal(principal), id, assessmentId, {
      documentId: dto.documentId,
      note: dto.note,
    });
  }

  @Delete(':id/statutory-audit/framework/evidence/:evidenceId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Unlink a framework evidence item' })
  removeEvidence(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('evidenceId', new ParseUUIDPipe()) evidenceId: string,
  ): Promise<StatutoryAuditFramework> {
    return this.framework.removeEvidence(rlsContextFromPrincipal(principal), id, evidenceId);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/framework/approve')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Approve the Framework Memo — freezes conclusions and completes Phase 02 (§18)',
    description: 'Rejected (400) while any area still lacks a professional conclusion.',
  })
  approve(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: ApproveFrameworkDto,
  ): Promise<StatutoryAuditFramework> {
    return this.framework.approveFramework(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      {
        memo: dto.memo,
      },
    );
  }
}
