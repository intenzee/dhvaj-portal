import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type StatutoryAuditWorkflow } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { StatutoryAuditWorkflowService } from './statutory-audit-workflow.service';

/**
 * Statutory Audit read surface (Audit Spec §7, §8, §10). Gated by
 * `engagement.read` — RLS does the real gating (only engagement members see an
 * audit file), consistent with time tracking and reviews.
 */
@ApiTags('engagements')
@Controller('engagements')
export class StatutoryAuditController {
  constructor(private readonly workflow: StatutoryAuditWorkflowService) {}

  @Get(':id/statutory-audit')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'The statutory-audit workflow shell(s) on an engagement, with phases',
    description:
      'Powers the Services readiness strip and the Work-tab left audit-file navigation. Empty when the engagement carries no statutory-audit service.',
  })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StatutoryAuditWorkflow[]> {
    return this.workflow.listForEngagement(rlsContextFromPrincipal(principal), id);
  }
}
