import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type Paginated } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { PaginationQueryDto, paginate } from '../../common/pagination/pagination.dto';
import { ComplianceInstancesService } from './compliance-instances.service';
import type { ComplianceInstanceDetail, ComplianceInstanceRecord } from './compliance.types';
import {
  CompleteInstanceDto,
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
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<ComplianceInstanceRecord>> {
    return this.instances
      .list(rlsContextFromPrincipal(principal), id, query)
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
