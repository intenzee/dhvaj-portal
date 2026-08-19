import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type Paginated } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { ClientDependenciesService } from './client-dependencies.service';
import type { ClientDependencyRecord } from './tasks.types';
import {
  ClientDependencyListQueryDto,
  CloseClientDependencyDto,
  CreateClientDependencyDto,
  ReceiveClientDependencyDto,
  UpdateClientDependencyDto,
} from './dto/client-dependency.dto';

/**
 * Client dependencies (Phase 9) — information requested from the client. An open
 * dependency makes the engagement "waiting for client". Reads need
 * `engagement.read`; all writes need `engagement.manage` (lead-managed).
 */
@ApiTags('engagement-client-dependencies')
@Controller('engagements')
export class ClientDependenciesController {
  constructor(private readonly deps: ClientDependenciesService) {}

  @Get(':id/client-dependencies')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'List client dependencies (paginated); filter ?status=&openOnly=' })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ClientDependencyListQueryDto,
  ): Promise<Paginated<ClientDependencyRecord>> {
    const filter: { status?: ClientDependencyListQueryDto['status']; openOnly?: boolean } = {};
    if (query.status) filter.status = query.status;
    if (query.openOnly !== undefined) filter.openOnly = query.openOnly;
    return this.deps
      .list(rlsContextFromPrincipal(principal), id, query, filter)
      .then((result) => paginate(result, query));
  }

  @Get(':id/client-dependencies/:dependencyId')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Get one client dependency' })
  getOne(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('dependencyId', new ParseUUIDPipe()) dependencyId: string,
  ): Promise<ClientDependencyRecord> {
    return this.deps.getOne(rlsContextFromPrincipal(principal), id, dependencyId);
  }

  @Post(':id/client-dependencies')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Request information from the client (audited)',
    description: 'Creating an open dependency puts the engagement into "waiting for client".',
  })
  request(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateClientDependencyDto,
  ): Promise<ClientDependencyRecord> {
    return this.deps.request(rlsContextFromPrincipal(principal), id, dto);
  }

  @Patch(':id/client-dependencies/:dependencyId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update reminder/escalation/outstanding/responsible (audited)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('dependencyId', new ParseUUIDPipe()) dependencyId: string,
    @Body() dto: UpdateClientDependencyDto,
  ): Promise<ClientDependencyRecord> {
    return this.deps.update(rlsContextFromPrincipal(principal), id, dependencyId, dto);
  }

  @Post(':id/client-dependencies/:dependencyId/receive')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Record receipt (fully or partially) of the requested information (audited)',
  })
  receive(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('dependencyId', new ParseUUIDPipe()) dependencyId: string,
    @Body() dto: ReceiveClientDependencyDto,
  ): Promise<ClientDependencyRecord> {
    return this.deps.receive(rlsContextFromPrincipal(principal), id, dependencyId, dto);
  }

  @Post(':id/client-dependencies/:dependencyId/close')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Waive or cancel a dependency (audited; reason required)' })
  close(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('dependencyId', new ParseUUIDPipe()) dependencyId: string,
    @Body() dto: CloseClientDependencyDto,
  ): Promise<ClientDependencyRecord> {
    return this.deps.close(rlsContextFromPrincipal(principal), id, dependencyId, dto);
  }
}
