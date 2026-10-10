import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type ManagerialPersonInput,
  type SetOtherReportingFactsInput,
  type SoftwareSystemInput,
  type StatutoryAuditOtherReporting,
  type StatutoryAuditOtherReportingMasterFillResult,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditOtherReportingService } from './audit-other-reporting.service';
import {
  ManagerialPersonDto,
  PartnerApproveOtherReportingDto,
  RecordOtherReportingDecisionDto,
  SetOtherReportingFactsDto,
  SoftwareSystemDto,
  UpdateReportingCardDto,
} from './dto/other-reporting.dto';

function toSystem(dto: SoftwareSystemDto): SoftwareSystemInput {
  return {
    ...dto,
    hasAuditTrailFeature: dto.hasAuditTrailFeature ?? false,
    auditTrailOperatedAllYear: dto.auditTrailOperatedAllYear ?? false,
  };
}

function toPerson(dto: ManagerialPersonDto): ManagerialPersonInput {
  return { ...dto, remuneration: dto.remuneration ?? null };
}

/**
 * Statutory Audit — 02.7 Other Companies Act & Statutory Reporting endpoints
 * (DHVAJ 02.7 spec). Reads gated by `engagement.read`, mutations by
 * `engagement.manage`; RLS does the real gating (members read; only leads
 * mutate the audit file; only the Engagement Partner approves).
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

  @Post(':id/statutory-audit/:workflowInstanceId/other-reporting/fill-from-master')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Fill the 02.7 facts from the client master and portal records',
    description:
      'Fills blank facts from the directors on the contacts master and the software register / managerial persons on the prior-year file and re-runs the engine; never overwrites what the team entered.',
  })
  fillFromMaster(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<StatutoryAuditOtherReportingMasterFillResult> {
    return this.other.fillFromMaster(rlsContextFromPrincipal(principal), id, workflowInstanceId);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/other-reporting/facts')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary:
      'Capture the 02.7 facts (Section 143(3), Rule 11, audit-trail register, Section 197, applicability overrides)',
  })
  setFacts(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: SetOtherReportingFactsDto,
  ): Promise<StatutoryAuditOtherReporting> {
    const input: SetOtherReportingFactsInput = {
      ...dto,
      softwareSystems: dto.softwareSystems?.map(toSystem),
      managerialPersons: dto.managerialPersons?.map(toPerson),
      applicabilityOverrides:
        dto.applicabilityOverrides as SetOtherReportingFactsInput['applicabilityOverrides'],
    };
    return this.other.setFacts(rlsContextFromPrincipal(principal), id, workflowInstanceId, input);
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
  @ApiOperation({
    summary:
      'Record the 02.7 conclusion — Confirm / Override (reason + technical basis + evidence) / Information Pending',
  })
  decision(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: RecordOtherReportingDecisionDto,
  ): Promise<StatutoryAuditOtherReporting> {
    return this.other.recordDecision(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      ...dto,
    });
  }

  @Post(':id/statutory-audit/:workflowInstanceId/other-reporting/partner-approve')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Engagement Partner approval of a significant 02.7 override' })
  partnerApprove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: PartnerApproveOtherReportingDto,
  ): Promise<StatutoryAuditOtherReporting> {
    return this.other.partnerApprove(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      ...dto,
    });
  }

  @Post(':id/statutory-audit/:workflowInstanceId/other-reporting/cards/:cardKey')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: "Set a 02.7 requirement card's work state (workable after 02.7 is approved)",
  })
  updateCard(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Param('cardKey') cardKey: string,
    @Body() dto: UpdateReportingCardDto,
  ): Promise<StatutoryAuditOtherReporting> {
    return this.other.updateCard(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      cardKey,
      { ...dto },
    );
  }
}
