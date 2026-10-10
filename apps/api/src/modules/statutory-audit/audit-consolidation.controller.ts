import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type InvesteeInput,
  type StatutoryAuditConsolidation,
  type StatutoryAuditConsolidationMasterFillResult,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditConsolidationService } from './audit-consolidation.service';
import {
  InvesteeDto,
  PartnerApproveConsolidationDto,
  RecordConsolidationDecisionDto,
  SetConsolidationFactsDto,
  UpdateConsolidationConversionDto,
} from './dto/consolidation.dto';

/** Normalise an investee DTO into the engine's fully-populated fact shape. */
function toInvestee(dto: InvesteeDto): InvesteeInput {
  return {
    id: dto.id?.trim() || undefined,
    name: dto.name.trim(),
    suggestedRelationship: dto.suggestedRelationship ?? null,
    ownershipPercent: dto.ownershipPercent ?? null,
    ownershipDirect: dto.ownershipDirect ?? null,
    ownershipIndirect: dto.ownershipIndirect ?? null,
    votingDirect: dto.votingDirect ?? null,
    votingIndirect: dto.votingIndirect ?? null,
    boardCompositionControl: dto.boardCompositionControl ?? null,
    boardRightsDetails: dto.boardRightsDetails?.trim() || null,
    contractualRights: dto.contractualRights?.trim() || null,
    hasControl: dto.hasControl ?? null,
    controlConclusion: dto.controlConclusion ?? null,
    isJointArrangement: dto.isJointArrangement ?? false,
    jointArrangementIsOperation: dto.jointArrangementIsOperation ?? false,
    jointControl: dto.jointControl ?? null,
    significantInfluenceRebutted: dto.significantInfluenceRebutted ?? null,
    significantInfluence: dto.significantInfluence ?? null,
    auditedByOtherAuditor: dto.auditedByOtherAuditor ?? false,
    effectiveFrom: dto.effectiveFrom ?? null,
    effectiveTo: dto.effectiveTo ?? null,
    country: dto.country?.trim() || null,
    isIndianCompany: dto.isIndianCompany ?? null,
    included: dto.included ?? null,
    inclusionReason: dto.inclusionReason?.trim() || null,
    reportingDate: dto.reportingDate ?? null,
    reportingDateReason: dto.reportingDateReason?.trim() || null,
    interimInformation: dto.interimInformation?.trim() || null,
    interveningTransactions: dto.interveningTransactions?.trim() || null,
    localFramework: dto.localFramework ?? null,
    policyAlignment: dto.policyAlignment ?? null,
    notes: dto.notes?.trim() || null,
  };
}

/**
 * Statutory Audit — 02.6 Consolidation & Group Audit Framework endpoints,
 * Track A (relationship assessment, Rule 6, perimeter, CFS-03/04 conversions,
 * CFS-05 conclusion + EP approval). Reads gated by `engagement.read`,
 * mutations by `engagement.manage`; RLS does the real gating (members read;
 * only leads mutate the audit file).
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditConsolidationController {
  constructor(private readonly consolidation: AuditConsolidationService) {}

  @Get(':id/statutory-audit/consolidation')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "An engagement's 02.6 consolidation / group-audit assessment(s)" })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StatutoryAuditConsolidation[]> {
    return this.consolidation.listForEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/consolidation/fill-from-master')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Fill the 02.6 facts from the client master',
    description:
      'Fills blank facts from the client master (group relationships, listings, branches) ' +
      'and re-runs the engine; never overwrites what the team entered.',
  })
  fillFromMaster(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<StatutoryAuditConsolidationMasterFillResult> {
    return this.consolidation.fillFromMaster(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/consolidation/facts')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Capture the 02.6 facts (relationship assessment, perimeter, Rule 6 evidence)',
  })
  setFacts(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: SetConsolidationFactsDto,
  ): Promise<StatutoryAuditConsolidation> {
    return this.consolidation.setFacts(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      investees: dto.investees ? dto.investees.map(toInvestee) : undefined,
      isWhollyOwnedSubsidiary: dto.isWhollyOwnedSubsidiary,
      isPartiallyOwnedSubsidiary: dto.isPartiallyOwnedSubsidiary,
      otherMembersIntimatedNoObjection: dto.otherMembersIntimatedNoObjection,
      securitiesListedOrInProcess: dto.securitiesListedOrInProcess,
      parentFilesCompliantCfs: dto.parentFilesCompliantCfs,
      hasBranches: dto.hasBranches,
      rule6Evidence: dto.rule6Evidence,
      version: dto.version,
    });
  }

  @Post(':id/statutory-audit/:workflowInstanceId/consolidation/run-suggestions')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Run the §129(3) / Rule 6 consolidation engine and persist the suggestion',
  })
  runSuggestions(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<StatutoryAuditConsolidation> {
    return this.consolidation.runSuggestions(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/consolidation/decision')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'CFS-05: confirm / override / mark Information Pending',
    description:
      'Override needs the final conclusion, a reason, the technical basis and supporting ' +
      'evidence; a significant override or a control / perimeter dispute then needs the ' +
      'Engagement Partner. The system conclusion is preserved beside the professional one.',
  })
  decision(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: RecordConsolidationDecisionDto,
  ): Promise<StatutoryAuditConsolidation> {
    return this.consolidation.recordDecision(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      {
        action: dto.action,
        conclusion: dto.conclusion,
        basis: dto.basis,
        technicalBasis: dto.technicalBasis,
        supportingEvidence: dto.supportingEvidence,
        pendingReason: dto.pendingReason,
        impact: dto.impact,
        version: dto.version,
      },
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/consolidation/partner-approval')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'CFS-05: Engagement Partner approves the consolidation conclusion' })
  partnerApprove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: PartnerApproveConsolidationDto,
  ): Promise<StatutoryAuditConsolidation> {
    return this.consolidation.partnerApprove(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      { note: dto.note, version: dto.version },
    );
  }

  @Patch(':id/statutory-audit/:workflowInstanceId/consolidation/conversions/:conversionId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'CFS-04: update a component conversion work item',
    description:
      'GAAP / policy differences, adjustment references, reviewer, reporting package and the ' +
      "final adjusted group TB. The component's statutory accounts are never altered.",
  })
  updateConversion(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Param('conversionId', new ParseUUIDPipe()) conversionId: string,
    @Body() dto: UpdateConsolidationConversionDto,
  ): Promise<StatutoryAuditConsolidation> {
    return this.consolidation.updateConversion(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      conversionId,
      {
        status: dto.status,
        differences: dto.differences?.map((d) => ({
          area: d.area,
          description: d.description,
          adjustmentReference: d.adjustmentReference ?? null,
          amount: d.amount ?? null,
        })),
        reviewerEmployeeId: dto.reviewerEmployeeId,
        reportingPackageDocumentId: dto.reportingPackageDocumentId,
        adjustedTbDocumentId: dto.adjustedTbDocumentId,
        version: dto.version,
      },
    );
  }
}
