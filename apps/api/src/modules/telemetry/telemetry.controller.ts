import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type WorkflowMeasuresReport } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { TelemetryBatchDto, WorkflowMeasuresQueryDto } from './telemetry.dto';
import { TelemetryService } from './telemetry.service';

/**
 * Staff Workflow · How we measure it. Not behind ff_filing_runs: the baseline is
 * recorded before the workflow is switched on.
 */
@ApiTags('telemetry')
@Controller('telemetry')
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  @Post()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Record route changes and row opens (no content)',
    description:
      'Paths with ids replaced and the names of query parameters only. Any signed-in user, for ' +
      'themselves. Ids left in a path are replaced again here; times are clamped to the last day.',
  })
  async record(
    @CurrentPrincipal() principal: Principal,
    @Body() body: TelemetryBatchDto,
  ): Promise<void> {
    await this.telemetry.record(rlsContextFromPrincipal(principal), body.events);
  }

  @Get('measures')
  @RequirePermissions(PERMISSION.reportRead)
  @ApiOperation({
    summary: 'The Staff Workflow measures for a window of IST days',
    description:
      'Steps to the first filing, exact-link share, review wait, filings past their internal ' +
      'date, data received → filed and unread actionable notifications, each with the window ' +
      'before it for comparison. Scoped to what the caller can see; `officeId` narrows it.',
  })
  measures(
    @CurrentPrincipal() principal: Principal,
    @Query() query: WorkflowMeasuresQueryDto,
  ): Promise<WorkflowMeasuresReport> {
    return this.telemetry.measures(rlsContextFromPrincipal(principal), query);
  }
}
