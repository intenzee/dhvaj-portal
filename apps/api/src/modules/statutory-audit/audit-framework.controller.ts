import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type StatutoryAuditFramework } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditFrameworkService } from './audit-framework.service';
import { AddFrameworkEvidenceDto, FrameworkDecisionDto } from './dto/framework.dto';

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

  @Post(':id/statutory-audit/:workflowInstanceId/framework/accept-suggestions')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Accept every waiting system suggestion as the conclusion, in one step',
    description:
      'Concludes each undecided area that carries a system suggestion exactly as suggested; ' +
      'areas pending information or judgement are left for the team. 400 when none are waiting.',
  })
  acceptSuggestions(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<StatutoryAuditFramework> {
    return this.framework.acceptSuggestions(
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

  /**
   * Retired: Section 02 is approved once, through 02.8 (AF-01 Manager review →
   * Audit Framework Memorandum → AF-02 Engagement Partner conclusion).
   */
  @Post(':id/statutory-audit/:workflowInstanceId/framework/approve')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Retired — approve the framework through 02.8 AF-02',
    description: 'Always 409: the framework is approved by the Engagement Partner in 02.8.',
    deprecated: true,
  })
  approve(): never {
    throw new ConflictException(
      'Section 02 is approved in 02.8 Audit Framework Summary & Approval (AF-01, then AF-02).',
    );
  }
}
