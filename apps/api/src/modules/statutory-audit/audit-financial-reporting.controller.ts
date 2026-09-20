import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type StatutoryAuditFinancialReporting } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditFinancialReportingService } from './audit-financial-reporting.service';
import {
  RecordFinancialReportingDecisionDto,
  SetFinancialReportingFactsDto,
} from './dto/financial-reporting.dto';

/**
 * Statutory Audit — 02.2 Financial Reporting Framework endpoints (Guide §9.2).
 * Reads gated by `engagement.read`, mutations by `engagement.manage`; RLS does
 * the real gating (members read; only leads mutate the audit file).
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditFinancialReportingController {
  constructor(private readonly frf: AuditFinancialReportingService) {}

  @Get(':id/statutory-audit/financial-reporting')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "An engagement's 02.2 Financial Reporting Framework assessment(s)" })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StatutoryAuditFinancialReporting[]> {
    return this.frf.listForEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/financial-reporting/facts')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary:
      'Capture the 02.2-specific facts (prior/voluntary Ind AS, SME exchange, group trigger)',
  })
  setFacts(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: SetFinancialReportingFactsDto,
  ): Promise<StatutoryAuditFinancialReporting> {
    return this.frf.setFacts(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      isListedOnSmeExchange: dto.isListedOnSmeExchange,
      priorIndAs: dto.priorIndAs,
      voluntaryIndAs: dto.voluntaryIndAs,
      groupTriggersIndAs: dto.groupTriggersIndAs,
      version: dto.version,
    });
  }

  @Post(':id/statutory-audit/:workflowInstanceId/financial-reporting/run-suggestions')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Run the Rule-4 roadmap engine and persist the Ind AS / AS / specialised suggestion',
  })
  runSuggestions(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<StatutoryAuditFinancialReporting> {
    return this.frf.runSuggestions(rlsContextFromPrincipal(principal), id, workflowInstanceId);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/financial-reporting/decision')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Record the professional reporting-framework conclusion (override needs a basis)',
  })
  decision(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: RecordFinancialReportingDecisionDto,
  ): Promise<StatutoryAuditFinancialReporting> {
    return this.frf.recordDecision(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      conclusion: dto.conclusion,
      basis: dto.basis,
      impact: dto.impact,
      version: dto.version,
    });
  }
}
