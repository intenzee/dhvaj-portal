import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type StatutoryAuditWorkGeneration } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditWorkService } from './audit-work.service';

/**
 * Statutory Audit — Framework → Dynamic Work Generation endpoints (Audit Spec §20).
 * Reads are gated by `engagement.read`, generation by `engagement.manage` — RLS
 * does the real gating (members read; only leads generate).
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditWorkController {
  constructor(private readonly work: AuditWorkService) {}

  @Get(':id/statutory-audit/work-areas')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "An engagement's generated statutory-audit work areas (§20)" })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StatutoryAuditWorkGeneration[]> {
    return this.work.listForEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/work-areas/generate')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Generate applicable work areas from the approved framework (§20)',
    description:
      'Idempotent — re-running never duplicates and never deletes existing work; areas no ' +
      'longer applicable are deactivated. Rejected (409) until the Framework Memo is approved.',
  })
  generate(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<StatutoryAuditWorkGeneration> {
    return this.work.generate(rlsContextFromPrincipal(principal), id, workflowInstanceId);
  }
}
