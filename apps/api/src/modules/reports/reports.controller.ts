import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type ComplianceMisReport,
  type EngagementMisReport,
  type UtilisationReport,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { ReportsService } from './reports.service';

/**
 * Reports & MIS (management aggregations). Gated by `report.read` (Managing
 * Partner, admin, partner, manager). Every figure is RLS-scoped — the same
 * visibility as the caller's dashboard, rolled up for management.
 */
@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('engagements')
  @RequirePermissions(PERMISSION.reportRead)
  @ApiOperation({
    summary: 'Engagement MIS: totals and breakdowns by status/service line/office/EP',
  })
  engagements(@CurrentPrincipal() principal: Principal): Promise<EngagementMisReport> {
    return this.reports.engagementMis(rlsContextFromPrincipal(principal));
  }

  @Get('compliance')
  @RequirePermissions(PERMISSION.reportRead)
  @ApiOperation({ summary: 'Compliance MIS: open/overdue/due-soon by category' })
  compliance(
    @CurrentPrincipal() principal: Principal,
    @Query('dueSoonDays', new DefaultValuePipe(30), new ParseIntPipe()) dueSoonDays: number,
  ): Promise<ComplianceMisReport> {
    const days = Math.min(Math.max(dueSoonDays, 1), 180);
    return this.reports.complianceMis(rlsContextFromPrincipal(principal), days);
  }

  @Get('utilisation')
  @RequirePermissions(PERMISSION.reportRead)
  @ApiOperation({
    summary: 'Utilisation: per-employee workload (active engagements + open/overdue tasks)',
  })
  utilisation(@CurrentPrincipal() principal: Principal): Promise<UtilisationReport> {
    return this.reports.utilisation(rlsContextFromPrincipal(principal));
  }
}
