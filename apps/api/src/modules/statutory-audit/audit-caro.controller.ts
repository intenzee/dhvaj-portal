import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type StatutoryAuditCaro,
  type StatutoryAuditCaroMasterFillResult,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditCaroService } from './audit-caro.service';
import { PartnerApproveCaroDto, RecordCaroDecisionDto, SetCaroFactsDto } from './dto/caro.dto';

/**
 * Statutory Audit — 02.4 CARO 2020 Applicability endpoints (Guide §9.4). Reads
 * gated by `engagement.read`, mutations by `engagement.manage`; RLS does the real
 * gating (members read; only leads mutate the audit file).
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditCaroController {
  constructor(private readonly caro: AuditCaroService) {}

  @Get(':id/statutory-audit/caro')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "An engagement's 02.4 CARO 2020 applicability assessment(s)" })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StatutoryAuditCaro[]> {
    return this.caro.listForEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/caro/fill-from-master')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Fill the 02.4 facts from the client master',
    description:
      'Fills blank facts from the client master (group relationships, listings, branches, ' +
      'financial profile) and re-runs the engine; never overwrites what the team entered.',
  })
  fillFromMaster(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<StatutoryAuditCaroMasterFillResult> {
    return this.caro.fillFromMaster(rlsContextFromPrincipal(principal), id, workflowInstanceId);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/caro/facts')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary:
      'Capture the 02.4 CARO facts (public-group relationship, capital+reserves, borrowings peak, revenue)',
  })
  setFacts(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: SetCaroFactsDto,
  ): Promise<StatutoryAuditCaro> {
    return this.caro.setFacts(rlsContextFromPrincipal(principal), id, workflowInstanceId, dto);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/caro/run-suggestions')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Run the CARO 2020 applicability engine and persist the suggestion' })
  runSuggestions(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<StatutoryAuditCaro> {
    return this.caro.runSuggestions(rlsContextFromPrincipal(principal), id, workflowInstanceId);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/caro/decision')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary:
      'CARO-06: confirm, override (conclusion + reason + technical basis + evidence) or mark Information Pending',
  })
  decision(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: RecordCaroDecisionDto,
  ): Promise<StatutoryAuditCaro> {
    return this.caro.recordDecision(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/caro/partner-approve')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'CARO-06: Engagement Partner approval of a significant override' })
  partnerApprove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: PartnerApproveCaroDto,
  ): Promise<StatutoryAuditCaro> {
    return this.caro.partnerApprove(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }
}
