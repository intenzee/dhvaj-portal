import {
  Controller,
  DefaultValuePipe,
  Get,
  NotFoundException,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FEATURE_FLAG,
  PERMISSION,
  type ComplianceMisReport,
  type EngagementMisReport,
  type FirmTimeReport,
  type NoticesReport,
  type UtilisationReport,
} from '@hsdg/contracts';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { ReportsService } from './reports.service';
import { TimeTrackingService } from '../engagements/time/time-tracking.service';
import { NoticesReportService } from './notices-report.service';

/**
 * Reports & MIS (management aggregations). Gated by `report.read` (Managing
 * Partner, admin, partner, manager). Every figure is RLS-scoped — the same
 * visibility as the caller's dashboard, rolled up for management.
 */
@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly time: TimeTrackingService,
    private readonly notices: NoticesReportService,
    private readonly flags: FeatureFlagsService,
  ) {}

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

  @Get('time')
  @RequirePermissions(PERMISSION.reportRead)
  @ApiOperation({
    summary: 'Time tracking: hours logged per person across all visible engagements',
    description: 'Manual-stopwatch totals (ADR-0034), RLS-scoped like the other MIS reports.',
  })
  timeReport(@CurrentPrincipal() principal: Principal): Promise<FirmTimeReport> {
    return this.time.firmReport(rlsContextFromPrincipal(principal));
  }

  @Get('notices')
  @RequirePermissions(PERMISSION.reportRead)
  @ApiOperation({
    summary: "Notices (PS-105): the firm's open exposure, what is due this week, closed outcomes",
    description:
      'Open notices (count and amount demanded) by stream, status and office; open notices whose ' +
      'clock (noticeClock) falls due within 7 days of the IST today or is past; closed notices ' +
      'by outcome with the amount demanded against the outcome amount; and the mean days from ' +
      'receipt to the first reply filed. RLS-scoped like the other MIS reports (firm-wide for ' +
      "the Managing Partner, the caller's engagements otherwise); ?officeId= narrows to the " +
      "engagement's office. Amounts are decimal strings. Behind ff_notices.",
  })
  noticesReport(
    @CurrentPrincipal() principal: Principal,
    @Query('officeId', new ParseUUIDPipe({ optional: true })) officeId?: string,
  ): Promise<NoticesReport> {
    if (!this.flags.isOnFor(FEATURE_FLAG.notices, principal.officeCode)) {
      throw new NotFoundException('Notices are not switched on for your office yet.');
    }
    return this.notices.report(rlsContextFromPrincipal(principal), officeId ?? null);
  }
}
