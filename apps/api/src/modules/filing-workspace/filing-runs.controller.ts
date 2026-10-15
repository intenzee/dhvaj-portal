import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FEATURE_FLAG,
  PERMISSION,
  type ClientChase,
  type ClientReminderResult,
  type FilingRun,
  type FilingRunBulkResult,
  type FilingRunForm,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { FilingRunsService } from './filing-runs.service';
import { ClientChaseService } from './client-chase.service';
import {
  FilingRunAssignDto,
  FilingRunFormsQueryDto,
  FilingRunInstancesDto,
  FilingRunQueryDto,
} from './dto/filing-runs.dto';

/**
 * Staff Workflow WF-301 — filing runs. Behind ff_filing_runs (404 when off for
 * the caller's office). Reads need `engagement.read` and are scoped by RLS;
 * bulk assign needs `engagement.manage` and is lead-only per filing; bulk
 * remind is open to any engagement member, checked per filing.
 */
@ApiTags('filing-runs')
@Controller('compliance/runs')
export class FilingRunsController {
  constructor(
    private readonly runs: FilingRunsService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get('forms')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Forms and periods with filings due around today, for the run picker' })
  forms(
    @CurrentPrincipal() principal: Principal,
    @Query() query: FilingRunFormsQueryDto,
  ): Promise<FilingRunForm[]> {
    this.requireFlag(principal);
    return this.runs.forms(rlsContextFromPrincipal(principal), query.scope);
  }

  @Get()
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'One form and period across every client: data, people, lodge state' })
  run(
    @CurrentPrincipal() principal: Principal,
    @Query() query: FilingRunQueryDto,
  ): Promise<FilingRun> {
    this.requireFlag(principal);
    return this.runs.run(rlsContextFromPrincipal(principal), query.rule, query.period, query.scope);
  }

  @Post('assign')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Assign a preparer and/or reviewer on many filings (per-filing result)',
    description:
      'Per filing: an engagement lead, or the filing’s stream lead when the firm lets stream ' +
      'leads bulk-assign (Admin → Workflow). Others get that filing back as failed.',
  })
  assign(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: FilingRunAssignDto,
  ): Promise<FilingRunBulkResult> {
    this.requireFlag(principal);
    return this.runs.assign(rlsContextFromPrincipal(principal), dto.instanceIds, {
      ...(dto.preparerId !== undefined ? { preparerId: dto.preparerId } : {}),
      ...(dto.reviewerId !== undefined ? { reviewerId: dto.reviewerId } : {}),
    });
  }

  @Post('remind')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Remind each filing’s client of what is still outstanding' })
  remind(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: FilingRunInstancesDto,
  ): Promise<FilingRunBulkResult> {
    this.requireFlag(principal);
    return this.runs.remind(rlsContextFromPrincipal(principal), dto.instanceIds);
  }

  private requireFlag(principal: Principal): void {
    if (!this.flags.isOnFor(FEATURE_FLAG.filingRuns, principal.officeCode))
      throw new NotFoundException();
  }
}

/**
 * Staff Workflow WF-302 — "Waiting on client" on a filing. Any engagement
 * member may read and remind; membership is checked in the service and RLS.
 */
@ApiTags('filing-workspace')
@Controller('compliance-instances')
export class ClientChaseController {
  constructor(private readonly chase: ClientChaseService) {}

  @Get(':id/client-chase')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'What the filing is waiting on from the client, and a reminder text' })
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ClientChase> {
    return this.chase.get(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/client-chase/remind')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Remind the client: e-mail with upload links when possible, else text to copy',
  })
  remind(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ClientReminderResult> {
    return this.chase.remind(rlsContextFromPrincipal(principal), id);
  }
}
