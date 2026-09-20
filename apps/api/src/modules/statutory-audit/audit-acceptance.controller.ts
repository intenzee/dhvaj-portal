import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type StatutoryAuditAcceptance } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditAcceptanceService } from './audit-acceptance.service';
import {
  ApproveAcceptanceDto,
  RecordAcceptanceAnswerDto,
  SetSegmentStateDto,
} from './dto/acceptance.dto';

/**
 * Statutory Audit — Section 01 Engagement & Acceptance endpoints (Guide §8).
 * Reads gated by `engagement.read`, mutations by `engagement.manage`; RLS does
 * the real gating (members read; only leads mutate the audit file).
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditAcceptanceController {
  constructor(private readonly acceptance: AuditAcceptanceService) {}

  @Get(':id/statutory-audit/acceptance')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "An engagement's Section 01 acceptance segments + approval" })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StatutoryAuditAcceptance[]> {
    return this.acceptance.listForEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/statutory-audit/acceptance/segments/:segmentId/answer')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Record a Yes/No/NA answer; adverse answers raise Matters (§8.4)' })
  answer(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('segmentId', new ParseUUIDPipe()) segmentId: string,
    @Body() dto: RecordAcceptanceAnswerDto,
  ): Promise<StatutoryAuditAcceptance> {
    return this.acceptance.recordAnswer(rlsContextFromPrincipal(principal), id, segmentId, {
      questionKey: dto.questionKey,
      answer: dto.answer,
      narrative: dto.narrative,
      documentId: dto.documentId,
    });
  }

  @Post(':id/statutory-audit/acceptance/segments/:segmentId/state')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Mark a segment complete / not-applicable / reopen (§8.3)' })
  setState(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('segmentId', new ParseUUIDPipe()) segmentId: string,
    @Body() dto: SetSegmentStateDto,
  ): Promise<StatutoryAuditAcceptance> {
    return this.acceptance.setSegmentState(rlsContextFromPrincipal(principal), id, segmentId, {
      state: dto.state,
      version: dto.version,
    });
  }

  @Post(':id/statutory-audit/:workflowInstanceId/acceptance/approve')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Engagement Partner approval (FINAL-02) — completes Section 01, unlocks Section 02',
    description: 'Rejected while a segment is incomplete or a blocking matter is open.',
  })
  approve(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: ApproveAcceptanceDto,
  ): Promise<StatutoryAuditAcceptance> {
    return this.acceptance.approve(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      conclusion: dto.conclusion,
      memo: dto.memo,
    });
  }
}
