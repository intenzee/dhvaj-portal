import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type SoftwareSystemInput,
  type StatutoryAuditOtherReporting,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditOtherReportingService } from './audit-other-reporting.service';
import {
  RecordOtherReportingDecisionDto,
  SetOtherReportingFactsDto,
  SoftwareSystemDto,
} from './dto/other-reporting.dto';

function toSystem(dto: SoftwareSystemDto): SoftwareSystemInput {
  return {
    name: dto.name,
    hasAuditTrailFeature: dto.hasAuditTrailFeature ?? false,
    auditTrailOperatedAllYear: dto.auditTrailOperatedAllYear ?? false,
  };
}

/**
 * Statutory Audit — 02.7 Other Companies Act & Statutory Reporting endpoints
 * (Guide §9.7). Reads gated by `engagement.read`, mutations by `engagement.manage`;
 * RLS does the real gating (members read; only leads mutate the audit file).
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditOtherReportingController {
  constructor(private readonly other: AuditOtherReportingService) {}

  @Get(':id/statutory-audit/other-reporting')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "An engagement's 02.7 statutory-reporting matrix assessment(s)" })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StatutoryAuditOtherReporting[]> {
    return this.other.listForEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/other-reporting/facts')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary:
      'Capture the 02.7 reporting-matrix facts (audit trail, remuneration, fraud, 11(e)/(f))',
  })
  setFacts(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: SetOtherReportingFactsDto,
  ): Promise<StatutoryAuditOtherReporting> {
    return this.other.setFacts(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      softwareSystems: dto.softwareSystems ? dto.softwareSystems.map(toSystem) : undefined,
      managerialRemunerationPaid: dto.managerialRemunerationPaid,
      section198NetProfit: dto.section198NetProfit,
      hasManagingOrWholeTimeDirector: dto.hasManagingOrWholeTimeDirector,
      fraudIdentified: dto.fraudIdentified,
      fraudAmount: dto.fraudAmount,
      fraudEventDate: dto.fraudEventDate,
      intermediaryFundsAdvanced: dto.intermediaryFundsAdvanced,
      ultimateBeneficiaryFundsReceived: dto.ultimateBeneficiaryFundsReceived,
      fundingRepresentationsObtained: dto.fundingRepresentationsObtained,
      dividendCompliesSec123: dto.dividendCompliesSec123,
      pendingLitigationDisclosed: dto.pendingLitigationDisclosed,
      foreseeableLossesProvided: dto.foreseeableLossesProvided,
      iepfTransferDelay: dto.iepfTransferDelay,
      version: dto.version,
    });
  }

  @Post(':id/statutory-audit/:workflowInstanceId/other-reporting/run-suggestions')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Run the 02.7 reporting-matrix engine and persist the suggestion' })
  runSuggestions(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<StatutoryAuditOtherReporting> {
    return this.other.runSuggestions(rlsContextFromPrincipal(principal), id, workflowInstanceId);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/other-reporting/decision')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Record the professional 02.7 conclusion (override needs a basis)' })
  decision(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: RecordOtherReportingDecisionDto,
  ): Promise<StatutoryAuditOtherReporting> {
    return this.other.recordDecision(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      conclusion: dto.conclusion,
      basis: dto.basis,
      impact: dto.impact,
      version: dto.version,
    });
  }
}
