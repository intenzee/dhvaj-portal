import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type StatutoryAuditIcfr } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditIcfrService } from './audit-icfr.service';
import { RecordIcfrDecisionDto, SetIcfrFactsDto } from './dto/icfr.dto';

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

  @Post(':id/statutory-audit/:workflowInstanceId/icfr/facts')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Capture the 02.5 ICFR facts (peak covered borrowings, §92/§137 filing default)',
  })
  setFacts(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: SetIcfrFactsDto,
  ): Promise<StatutoryAuditIcfr> {
    return this.icfr.setFacts(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      peakCoveredBorrowings: dto.peakCoveredBorrowings,
      filingDefault: dto.filingDefault,
      version: dto.version,
    });
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
  @ApiOperation({ summary: 'Record the professional ICFR conclusion (override needs a basis)' })
  decision(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: RecordIcfrDecisionDto,
  ): Promise<StatutoryAuditIcfr> {
    return this.icfr.recordDecision(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      conclusion: dto.conclusion,
      basis: dto.basis,
      impact: dto.impact,
      version: dto.version,
    });
  }
}
