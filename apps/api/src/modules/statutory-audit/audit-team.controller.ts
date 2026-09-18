import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type AuditTeamMemberDetail, type StatutoryAuditTeam } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditTeamService } from './audit-team.service';
import { SetTeamAllocationDto } from './dto/team.dto';

/**
 * Statutory Audit — Team endpoints (Audit Spec §24). People + workload + time:
 * a per-person rollup (work items, planned/actual hours, reviewer flag) plus the
 * planned-hours allocation. Reads gated by `engagement.read`, mutations by
 * `engagement.manage`; RLS does the real gating (members read; only leads mutate).
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditTeamController {
  constructor(private readonly team: AuditTeamService) {}

  @Get(':id/statutory-audit/team')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "An engagement's audit team — workload + time (§24)" })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StatutoryAuditTeam[]> {
    return this.team.listForEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Get(':id/statutory-audit/:workflowInstanceId/team/:employeeId')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'One person — assigned areas, procedures, reviews and time (§24)' })
  detail(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
  ): Promise<AuditTeamMemberDetail> {
    return this.team.memberDetail(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      employeeId,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/team/allocations')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: "Set a person's planned-hours allocation (§21, §24)" })
  setAllocation(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: SetTeamAllocationDto,
  ): Promise<StatutoryAuditTeam> {
    return this.team.setAllocation(rlsContextFromPrincipal(principal), id, workflowInstanceId, dto);
  }

  @Delete(':id/statutory-audit/:workflowInstanceId/team/allocations/:employeeId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Remove a planned-hours allocation (§24)' })
  removeAllocation(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
  ): Promise<StatutoryAuditTeam> {
    return this.team.deleteAllocation(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      employeeId,
    );
  }
}
