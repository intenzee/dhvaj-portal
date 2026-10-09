import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type FinancialReportingDownstreamView } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditFrameworkDownstreamService } from './audit-framework-downstream.service';

/**
 * Statutory Audit — 02.2 "Downstream impact" (DHVAJ 02.2 spec §5, §19): what
 * the 02.2 conclusion activates in 02.3 and the audit work. Read-only; the
 * actions go live when Section 02 is approved.
 */
@ApiTags('engagements')
@Controller('engagements/:id/statutory-audit/:workflowInstanceId/financial-reporting')
export class AuditFrameworkDownstreamController {
  constructor(private readonly downstream: AuditFrameworkDownstreamService) {}

  @Get('downstream')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'What the 02.2 conclusion activates in 02.3 and the audit work' })
  view(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
  ): Promise<FinancialReportingDownstreamView> {
    return this.downstream.view(rlsContextFromPrincipal(principal), id, wf);
  }
}
