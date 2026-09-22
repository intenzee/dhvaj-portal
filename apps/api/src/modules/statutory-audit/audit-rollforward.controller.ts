import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type RollForwardComparison } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditRollForwardService } from './audit-rollforward.service';

/**
 * Statutory Audit — prior-year roll-forward endpoints (Guide §12). Reads gated by
 * `engagement.read`, the apply mutation by `engagement.manage`; RLS does the real
 * gating (members read; only leads mutate the audit file).
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditRollForwardController {
  constructor(private readonly rollforward: AuditRollForwardService) {}

  @Get(':id/statutory-audit/:workflowInstanceId/roll-forward')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Prior-year vs current comparison for a continuing audit (§12)' })
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<RollForwardComparison> {
    return this.rollforward.getComparison(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/roll-forward/apply')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary:
      'Carry stable prior conclusions forward as System Suggested and flag changes for re-evaluation',
  })
  apply(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<RollForwardComparison> {
    return this.rollforward.apply(rlsContextFromPrincipal(principal), id, workflowInstanceId);
  }
}
