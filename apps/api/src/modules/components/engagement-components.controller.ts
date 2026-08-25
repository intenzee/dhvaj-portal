import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type ComponentDiscoveryResult,
  type EngagementComponentRecord,
  type Paginated,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { EngagementComponentsService } from './engagement-components.service';
import {
  ConfigureComponentDto,
  EngagementComponentListQueryDto,
  RemoveEngagementComponentDto,
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
  constructor(private readonly components: EngagementComponentsService) {}

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
}
