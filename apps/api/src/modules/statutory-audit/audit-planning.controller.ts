import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type StatutoryAuditPlanning } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditPlanningService } from './audit-planning.service';
import { ApprovePlanningDto, SetMaterialityDto, UpdatePlanningItemDto } from './dto/planning.dto';

/**
 * Statutory Audit — Planning (Phase 03) endpoints (Audit Spec §21). Reads are
 * gated by `engagement.read`, mutations by `engagement.manage`; RLS does the
 * real gating (members read; only leads mutate).
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditPlanningController {
  constructor(private readonly planning: AuditPlanningService) {}

  @Get(':id/statutory-audit/planning')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "An engagement's statutory-audit planning file (§21)" })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StatutoryAuditPlanning[]> {
    return this.planning.listForEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/statutory-audit/planning/:itemId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update a planning sub-area (state / narrative) (§21)' })
  updateItem(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body() dto: UpdatePlanningItemDto,
  ): Promise<StatutoryAuditPlanning> {
    return this.planning.updateItem(rlsContextFromPrincipal(principal), id, itemId, {
      state: dto.state,
      narrative: dto.narrative,
      version: dto.version,
    });
  }

  @Post(':id/statutory-audit/:workflowInstanceId/planning/materiality')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Set / update the materiality record (§21)' })
  setMateriality(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: SetMaterialityDto,
  ): Promise<StatutoryAuditPlanning> {
    return this.planning.setMateriality(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      {
        overallMateriality: dto.overallMateriality,
        performanceMateriality: dto.performanceMateriality,
        clearlyTrivialThreshold: dto.clearlyTrivialThreshold,
        benchmark: dto.benchmark,
        basis: dto.basis,
        version: dto.version,
      },
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/planning/approve')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Approve Planning — completes Phase 03 and unlocks Risk (§21)',
    description:
      'Rejected while the framework is unapproved (409) or any sub-area is incomplete (400).',
  })
  approve(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: ApprovePlanningDto,
  ): Promise<StatutoryAuditPlanning> {
    return this.planning.approvePlanning(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      {
        memo: dto.memo,
      },
    );
  }
}
