import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type StatutoryAuditFinancialReporting,
  type StatutoryAuditFinancialReportingMasterFillResult,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditFinancialReportingService } from './audit-financial-reporting.service';
import {
  PartnerApproveFinancialReportingDto,
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

  @Post(':id/statutory-audit/:workflowInstanceId/financial-reporting/fill-from-master')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Fill the 02.2 facts from the client master and earlier audit files',
    description:
      "Fills the SME-exchange listing, prior Ind AS (last year's file) and the Rule 4 group " +
      'trigger (a group company listed on NSE/BSE or on Ind AS); never overwrites the team.',
  })
  fillFromMaster(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<StatutoryAuditFinancialReportingMasterFillResult> {
    return this.frf.fillFromMaster(rlsContextFromPrincipal(principal), id, workflowInstanceId);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/financial-reporting/facts')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary:
      'Capture the 02.2 answers (FRF-01..04, 06, group and SMC facts); a changed fact clears a recorded conclusion',
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
      priorFramework: dto.priorFramework,
      priorFrameworkSource: dto.priorFrameworkSource,
      indAsAlreadyApplicable: dto.indAsAlreadyApplicable,
      firstIndAsFy: dto.firstIndAsFy,
      originalTrigger: dto.originalTrigger,
      voluntaryAnswer: dto.voluntaryAnswer,
      voluntaryFirstIndAsFy: dto.voluntaryFirstIndAsFy,
      groupAnswer: dto.groupAnswer,
      groupNonSmc: dto.groupNonSmc,
      smcMaxBorrowings: dto.smcMaxBorrowings,
      firstTimeAdoption: dto.firstTimeAdoption,
      firstTimeAdoptionReason: dto.firstTimeAdoptionReason,
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
    summary: 'FRF-05 — Confirm System Assessment / Override (basis required) / Information Pending',
  })
  decision(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: RecordFinancialReportingDecisionDto,
  ): Promise<StatutoryAuditFinancialReporting> {
    return this.frf.recordDecision(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      action: dto.action,
      conclusion: dto.conclusion,
      basis: dto.basis,
      impact: dto.impact,
      pendingReason: dto.pendingReason,
      version: dto.version,
    });
  }

  @Post(':id/statutory-audit/:workflowInstanceId/financial-reporting/partner-approve')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'FRF-05 — Engagement Partner approval of a significant override / complex conclusion',
  })
  partnerApprove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: PartnerApproveFinancialReportingDto,
  ): Promise<StatutoryAuditFinancialReporting> {
    return this.frf.partnerApprove(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      note: dto.note,
      version: dto.version,
    });
  }
}
