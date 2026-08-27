import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type Paginated } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { ComplianceInstancesService } from './compliance-instances.service';
import type {
  BulkGenerateResult,
  ComplianceCalendarRecord,
  ComplianceInstanceDetail,
  ComplianceInstanceRecord,
} from './compliance.types';
import {
  ApplyExtensionDto,
  ClearExtensionDto,
  CompleteInstanceDto,
  ComplianceCalendarQueryDto,
  ComplianceInstanceListQueryDto,
  GenerateForServiceDto,
  GenerateInstanceDto,
  OverrideInstanceDto,
  WaiveInstanceDto,
} from './dto/instance.dto';

/**
 * Per-engagement compliance obligations (Phase 8), routed under the engagement.
 * Reads need `engagement.read` (RLS scopes to members); writes need
 * `engagement.manage` (RLS scopes to leads) — the same floor as the review
 * engine, so the platform admin never touches client compliance data.
 */
@ApiTags('engagement-compliance')
@Controller('engagements')
export class ComplianceInstancesController {
  constructor(private readonly instances: ComplianceInstancesService) {}

  @Get(':id/compliance')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'List the engagement’s compliance obligations (paginated)',
    description:
      'Each carries both clocks (effective statutory deadline + internal SLA) and derived ' +
      'overdue flags (statutory vs internally overdue).',
  })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ComplianceInstanceListQueryDto,
  ): Promise<Paginated<ComplianceInstanceRecord>> {
    const filter = query.status ? { status: query.status } : {};
    return this.instances
      .list(rlsContextFromPrincipal(principal), id, query, filter)
      .then((result) => paginate(result, query));
  }

  @Get(':id/compliance/:instanceId')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Get one compliance obligation with its override history' })
  getOne(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('instanceId', new ParseUUIDPipe()) instanceId: string,
  ): Promise<ComplianceInstanceDetail> {
    return this.instances.getOne(rlsContextFromPrincipal(principal), id, instanceId);
  }

  @Post(':id/compliance')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Generate a compliance obligation from a rule (audited)',
    description:
      'Selects the rule version in force as of the reference date, computes both clocks, and ' +
      'snapshots the version used — so a later rule change never rewrites this instance.',
  })
  generate(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: GenerateInstanceDto,
  ): Promise<ComplianceInstanceRecord> {
    return this.instances.generate(rlsContextFromPrincipal(principal), id, dto);
  }

  @Post(':id/compliance/generate-for-service')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Generate obligations for all active rules on the engagement’s service (audited)',
    description:
      'Bulk generation. Rules that need an explicit date (period/event basis), do not apply under ' +
      'the context, or already exist are returned in `skipped` with a reason, not failed.',
  })
  generateForService(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: GenerateForServiceDto,
  ): Promise<BulkGenerateResult> {
    return this.instances.generateForService(rlsContextFromPrincipal(principal), id, dto);
  }

  @Post(':id/compliance/:instanceId/override')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Override a deadline on one clock (audited; reason required)',
    description: 'Records the previous → new date, reason, and evidence in the override history.',
  })
  override(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('instanceId', new ParseUUIDPipe()) instanceId: string,
    @Body() dto: OverrideInstanceDto,
  ): Promise<ComplianceInstanceDetail> {
    return this.instances.override(rlsContextFromPrincipal(principal), id, instanceId, dto);
  }

  @Post(':id/compliance/:instanceId/apply-extension')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Apply a government extension overlay to a deadline (§19; audited)',
    description:
      'References a firm-wide government extension by id. The original computed date is retained; ' +
      'the effective statutory date becomes the revised date (unless a manual override, which ' +
      'takes precedence, is present). Must target the same rule as the obligation.',
  })
  applyExtension(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('instanceId', new ParseUUIDPipe()) instanceId: string,
    @Body() dto: ApplyExtensionDto,
  ): Promise<ComplianceInstanceDetail> {
    return this.instances.applyExtension(rlsContextFromPrincipal(principal), id, instanceId, dto);
  }

  @Post(':id/compliance/:instanceId/clear-extension')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Remove a government extension overlay (§19; audited)' })
  clearExtension(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('instanceId', new ParseUUIDPipe()) instanceId: string,
    @Body() dto: ClearExtensionDto,
  ): Promise<ComplianceInstanceDetail> {
    return this.instances.clearExtension(
      rlsContextFromPrincipal(principal),
      id,
      instanceId,
      dto.version,
    );
  }

  @Post(':id/compliance/:instanceId/complete')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Mark a compliance obligation completed (audited)' })
  complete(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('instanceId', new ParseUUIDPipe()) instanceId: string,
    @Body() dto: CompleteInstanceDto,
  ): Promise<ComplianceInstanceRecord> {
    return this.instances.complete(rlsContextFromPrincipal(principal), id, instanceId, dto);
  }

  @Post(':id/compliance/:instanceId/waive')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Waive a compliance obligation (audited; reason required)' })
  waive(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('instanceId', new ParseUUIDPipe()) instanceId: string,
    @Body() dto: WaiveInstanceDto,
  ): Promise<ComplianceInstanceRecord> {
    return this.instances.waive(rlsContextFromPrincipal(principal), id, instanceId, dto);
  }
}

/**
 * Firm-wide compliance calendar (Phase 8 / §12). Cross-engagement view of
 * obligations, RLS-scoped to what the caller can see, for dashboards and the
 * Compliance Calendar. Reads need `engagement.read` (same floor as the
 * per-engagement list).
 */
@ApiTags('engagement-compliance')
@Controller('compliance')
export class ComplianceCalendarController {
  constructor(private readonly instances: ComplianceInstancesService) {}

  @Get()
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Firm-wide compliance calendar (paginated, RLS-scoped)',
    description:
      'Obligations across all engagements the caller can access, ordered by effective statutory ' +
      'deadline. Filter by ?status=, ?dueFrom=/?dueTo=, and ?overdueOnly=true.',
  })
  calendar(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ComplianceCalendarQueryDto,
  ): Promise<Paginated<ComplianceCalendarRecord>> {
    const filter: {
      status?: ComplianceCalendarQueryDto['status'];
      dueFrom?: string;
      dueTo?: string;
      overdueOnly?: boolean;
      dueDateCategory?: ComplianceCalendarQueryDto['dueDateCategory'];
    } = {};
    if (query.status) filter.status = query.status;
    if (query.dueFrom) filter.dueFrom = query.dueFrom;
    if (query.dueTo) filter.dueTo = query.dueTo;
    if (query.overdueOnly !== undefined) filter.overdueOnly = query.overdueOnly;
    if (query.dueDateCategory) filter.dueDateCategory = query.dueDateCategory;
    return this.instances
      .calendar(rlsContextFromPrincipal(principal), query, filter)
      .then((result) => paginate(result, query));
  }
}
