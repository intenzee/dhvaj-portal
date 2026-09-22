import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type InvesteeInput, type StatutoryAuditConsolidation } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditConsolidationService } from './audit-consolidation.service';
import {
  InvesteeDto,
  RecordConsolidationDecisionDto,
  SetConsolidationFactsDto,
} from './dto/consolidation.dto';

/** Normalise an investee DTO into the engine's fully-populated fact shape. */
function toInvestee(dto: InvesteeDto): InvesteeInput {
  return {
    name: dto.name,
    ownershipPercent: dto.ownershipPercent ?? null,
    hasControl: dto.hasControl ?? null,
    isJointArrangement: dto.isJointArrangement ?? false,
    jointArrangementIsOperation: dto.jointArrangementIsOperation ?? false,
    significantInfluenceRebutted: dto.significantInfluenceRebutted ?? null,
    auditedByOtherAuditor: dto.auditedByOtherAuditor ?? false,
  };
}

/**
 * Statutory Audit — 02.6 Consolidation / Group Audit Framework endpoints
 * (Guide §9.6). Reads gated by `engagement.read`, mutations by `engagement.manage`;
 * RLS does the real gating (members read; only leads mutate the audit file).
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

  @Post(':id/statutory-audit/:workflowInstanceId/consolidation/facts')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Capture the 02.6 facts (investee perimeter, Rule 6 conditions, branches)',
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
      version: dto.version,
    });
  }

  @Post(':id/statutory-audit/:workflowInstanceId/consolidation/run-suggestions')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Run the §129(3)/Rule 6 consolidation engine and persist the suggestion',
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
  @ApiOperation({ summary: 'Record the professional CFS conclusion (override needs a basis)' })
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
        conclusion: dto.conclusion,
        basis: dto.basis,
        impact: dto.impact,
        version: dto.version,
      },
    );
  }
}
