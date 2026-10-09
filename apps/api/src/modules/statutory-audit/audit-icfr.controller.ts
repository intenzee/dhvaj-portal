import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type StatutoryAuditIcfr,
  type StatutoryAuditIcfrMasterFillResult,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditIcfrService } from './audit-icfr.service';
import { PartnerApproveIcfrDto, RecordIcfrDecisionDto, SetIcfrFactsDto } from './dto/icfr.dto';

/**
 * Statutory Audit — 02.5 Internal Financial Controls / ICFR Reporting endpoints
 * (Guide §9.5). Reads gated by `engagement.read`, mutations by `engagement.manage`;
 * RLS does the real gating (members read; only leads mutate the audit file).
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditIcfrController {
  constructor(private readonly icfr: AuditIcfrService) {}

  @Get(':id/statutory-audit/icfr')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "An engagement's 02.5 ICFR / §143(3)(i) reporting assessment(s)" })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StatutoryAuditIcfr[]> {
    return this.icfr.listForEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/icfr/fill-from-master')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Fill the 02.5 facts from the client master and portal records',
    description:
      'Fills blank facts from the ROC filing record (AOC-4 / MGT-7 on the compliance calendar) and re-runs the engine; never overwrites what the team entered.',
  })
  fillFromMaster(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<StatutoryAuditIcfrMasterFillResult> {
    return this.icfr.fillFromMaster(rlsContextFromPrincipal(principal), id, workflowInstanceId);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/icfr/facts')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary:
      'Capture the 02.5 ICFR facts — IFC-01 audited turnover, IFC-02 borrowing schedule / peak, IFC-03 §137 / §92 filings',
  })
  setFacts(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: SetIcfrFactsDto,
  ): Promise<StatutoryAuditIcfr> {
    return this.icfr.setFacts(rlsContextFromPrincipal(principal), id, workflowInstanceId, dto);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/icfr/run-suggestions')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Run the §143(3)(i) ICFR-reporting engine and persist the suggestion' })
  runSuggestions(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<StatutoryAuditIcfr> {
    return this.icfr.runSuggestions(rlsContextFromPrincipal(principal), id, workflowInstanceId);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/icfr/decision')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary:
      'IFC-04: Confirm / Override (reason + technical basis + evidence) / Information Pending',
  })
  decision(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: RecordIcfrDecisionDto,
  ): Promise<StatutoryAuditIcfr> {
    return this.icfr.recordDecision(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/icfr/partner-approve')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'IFC-04: Engagement Partner approval of a significant override / complex assessment',
  })
  partnerApprove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: PartnerApproveIcfrDto,
  ): Promise<StatutoryAuditIcfr> {
    return this.icfr.partnerApprove(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }
}
