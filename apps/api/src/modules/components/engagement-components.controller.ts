import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type ComponentDiscoveryResult,
  type ComponentInstanceRecord,
  type EngagementComponentRecord,
  type GenerateInstancesResult,
  type Paginated,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { EngagementComponentsService } from './engagement-components.service';
import { ComponentInstancesService } from './component-instances.service';
import {
  ComponentWorkListQueryDto,
  ConfigureComponentDto,
  EngagementComponentListQueryDto,
  RemoveEngagementComponentDto,
  SetInstanceStatusDto,
  UpdateEngagementComponentDto,
} from './dto/engagement-component.dto';

/**
 * Per-engagement component CONFIGURATION and the Component Discovery engine
 * (spec §11–§13, §16, §24), routed under the engagement. Reads need
 * `engagement.read` (RLS scopes to members); writes need `engagement.manage`
 * (RLS scopes to leads) — the same floor as the compliance and review engines.
 */
@ApiTags('engagement-components')
@Controller('engagements')
export class EngagementComponentsController {
  constructor(
    private readonly components: EngagementComponentsService,
    private readonly instances: ComponentInstancesService,
  ) {}

  @Get(':id/components/discovery')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Discover applicable components for the engagement’s service (§11/§12).',
    description:
      'Categorises the service catalogue (mandatory / applicable / optional / …), gives the ' +
      'reason, and previews the statutory & internal deadlines where a compliance rule governs ' +
      'the component and the basis is determinable without a per-instance date.',
  })
  discover(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ComponentDiscoveryResult> {
    return this.components.discover(rlsContextFromPrincipal(principal), id);
  }

  @Get(':id/components')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'List the engagement’s configured components (paginated).' })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: EngagementComponentListQueryDto,
  ): Promise<Paginated<EngagementComponentRecord>> {
    const filter = query.status ? { status: query.status } : {};
    return this.components
      .list(rlsContextFromPrincipal(principal), id, query, filter)
      .then((result) => paginate(result, query));
  }

  @Post(':id/components')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Select & configure a component on the engagement (audited).',
    description:
      'Duplication guard (§16/§35): a live configuration for the same component already existing ' +
      'on this engagement returns 409.',
  })
  configure(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ConfigureComponentDto,
  ): Promise<EngagementComponentRecord> {
    return this.components.configure(rlsContextFromPrincipal(principal), id, dto);
  }

  @Patch(':id/components/:componentId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Amend a component configuration (audited; optimistic-locked).' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('componentId', new ParseUUIDPipe()) componentId: string,
    @Body() dto: UpdateEngagementComponentDto,
  ): Promise<EngagementComponentRecord> {
    return this.components.update(rlsContextFromPrincipal(principal), id, componentId, dto);
  }

  @Post(':id/components/:componentId/remove')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Remove a component (§24): soft-cancel — stops future work, preserves history.',
  })
  remove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('componentId', new ParseUUIDPipe()) componentId: string,
    @Body() dto: RemoveEngagementComponentDto,
  ): Promise<EngagementComponentRecord> {
    return this.components.remove(rlsContextFromPrincipal(principal), id, componentId, dto.reason);
  }

  // ── Component work instances (spec §21–§22) ──────────────────────────────

  @Post(':id/components/:componentId/instances/generate')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Generate period work instances for one component (§21; idempotent).',
    description:
      'Creates one instance per period of the engagement’s financial year for the component’s ' +
      'frequency (one for a one-time component). Re-running never duplicates — existing periods ' +
      'are returned in `skipped`. Deadlines snapshot the effective compliance rule version.',
  })
  generateForComponent(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('componentId', new ParseUUIDPipe()) componentId: string,
  ): Promise<GenerateInstancesResult> {
    return this.instances.generateForComponent(rlsContextFromPrincipal(principal), id, componentId);
  }

  @Get(':id/components/:componentId/instances')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'List a component’s generated work instances (paginated).' })
  listInstances(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('componentId', new ParseUUIDPipe()) componentId: string,
    @Query() query: ComponentWorkListQueryDto,
  ): Promise<Paginated<ComponentInstanceRecord>> {
    const filter: { componentId?: string; status?: ComponentWorkListQueryDto['status'] } = {
      componentId,
    };
    if (query.status) filter.status = query.status;
    return this.instances
      .list(rlsContextFromPrincipal(principal), id, query, filter)
      .then((result) => paginate(result, query));
  }

  @Post(':id/component-work/generate')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Generate work for all live, applicable components on the engagement (bulk, §21).',
  })
  generateAll(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<GenerateInstancesResult> {
    return this.instances.generateAll(rlsContextFromPrincipal(principal), id);
  }

  @Get(':id/component-work')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'The engagement’s component work — all instances (§26 Work), paginated.',
    description:
      'Filter by ?componentId= and ?status=. Each row carries derived future/overdue flags.',
  })
  work(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ComponentWorkListQueryDto,
  ): Promise<Paginated<ComponentInstanceRecord>> {
    const filter: { componentId?: string; status?: ComponentWorkListQueryDto['status'] } = {};
    if (query.componentId) filter.componentId = query.componentId;
    if (query.status) filter.status = query.status;
    return this.instances
      .list(rlsContextFromPrincipal(principal), id, query, filter)
      .then((result) => paginate(result, query));
  }

  @Post(':id/component-work/:instanceId/status')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Set a work instance’s status (complete / waive / cancel; audited).' })
  setInstanceStatus(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('instanceId', new ParseUUIDPipe()) instanceId: string,
    @Body() dto: SetInstanceStatusDto,
  ): Promise<ComponentInstanceRecord> {
    return this.instances.setStatus(rlsContextFromPrincipal(principal), id, instanceId, dto);
  }
}
