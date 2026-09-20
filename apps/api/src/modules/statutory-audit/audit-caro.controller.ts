import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type StatutoryAuditCaro } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditCaroService } from './audit-caro.service';
import { RecordCaroDecisionDto, SetCaroFactsDto } from './dto/caro.dto';

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
    return this.caro.setFacts(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      isHoldingOrSubsidiaryOfPublic: dto.isHoldingOrSubsidiaryOfPublic,
      capitalPlusReserves: dto.capitalPlusReserves,
      peakBankFiBorrowings: dto.peakBankFiBorrowings,
      totalRevenue: dto.totalRevenue,
      version: dto.version,
    });
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
  @ApiOperation({ summary: 'Record the professional CARO conclusion (override needs a basis)' })
  decision(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: RecordCaroDecisionDto,
  ): Promise<StatutoryAuditCaro> {
    return this.caro.recordDecision(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      conclusion: dto.conclusion,
      basis: dto.basis,
      impact: dto.impact,
      version: dto.version,
    });
  }
}
