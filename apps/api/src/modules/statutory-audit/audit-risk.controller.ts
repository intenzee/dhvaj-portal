import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type StatutoryAuditRiskRegister } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditRiskService } from './audit-risk.service';
import { CreateRiskDto, UpdateRiskDto } from './dto/risk.dto';

/**
 * Statutory Audit — Risk Assessment (Phase 04) endpoints (Audit Spec §22). Reads
 * gated by `engagement.read`, mutations by `engagement.manage`; RLS does the real
 * gating. Risk mutations are also blocked until Planning is approved (§7 unlock).
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditRiskController {
  constructor(private readonly risk: AuditRiskService) {}

  @Get(':id/statutory-audit/risks')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "An engagement's statutory-audit risk register (§22)" })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StatutoryAuditRiskRegister[]> {
    return this.risk.listForEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/risks')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Add a risk to the register (§22)',
    description: 'Rejected (409) until Planning is approved.',
  })
  create(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: CreateRiskDto,
  ): Promise<StatutoryAuditRiskRegister> {
    return this.risk.createRisk(rlsContextFromPrincipal(principal), id, workflowInstanceId, dto);
  }

  @Post(':id/statutory-audit/risks/:riskId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update a risk-register row (§22)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('riskId', new ParseUUIDPipe()) riskId: string,
    @Body() dto: UpdateRiskDto,
  ): Promise<StatutoryAuditRiskRegister> {
    return this.risk.updateRisk(rlsContextFromPrincipal(principal), id, riskId, dto);
  }

  @Delete(':id/statutory-audit/risks/:riskId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Remove a risk from the register (§22)' })
  remove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('riskId', new ParseUUIDPipe()) riskId: string,
  ): Promise<StatutoryAuditRiskRegister> {
    return this.risk.deleteRisk(rlsContextFromPrincipal(principal), id, riskId);
  }
}
