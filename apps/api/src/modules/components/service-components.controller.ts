import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type Paginated, type ServiceComponentRecord } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { ServiceComponentsService } from './service-components.service';
import {
  CreateServiceComponentDto,
  ServiceComponentListQueryDto,
  UpdateServiceComponentDto,
} from './dto/service-component.dto';

/**
 * Firm-wide component CATALOGUE (spec §11/§13/§36). Reads need `service.read`
 * (all staff); writes need `service.manage` and are additionally floored by
 * `ctx_is_firmwide` RLS — the same posture as the service catalogue itself.
 */
@ApiTags('service-components')
@Controller('service-components')
export class ServiceComponentsController {
  constructor(private readonly components: ServiceComponentsService) {}

  @Get()
  @RequirePermissions(PERMISSION.serviceRead)
  @ApiOperation({ summary: 'List catalogue components (paginated; filter by service).' })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ServiceComponentListQueryDto,
  ): Promise<Paginated<ServiceComponentRecord>> {
    const filter: { serviceCode?: string; serviceId?: string; activeOnly?: boolean } = {};
    if (query.serviceCode) filter.serviceCode = query.serviceCode;
    if (query.serviceId) filter.serviceId = query.serviceId;
    if (query.activeOnly !== undefined) filter.activeOnly = query.activeOnly;
    return this.components
      .list(rlsContextFromPrincipal(principal), query, filter)
      .then((result) => paginate(result, query));
  }

  @Get(':idOrCode')
  @RequirePermissions(PERMISSION.serviceRead)
  @ApiOperation({ summary: 'Get one catalogue component (by id or code).' })
  getOne(
    @CurrentPrincipal() principal: Principal,
    @Param('idOrCode') idOrCode: string,
  ): Promise<ServiceComponentRecord> {
    return this.components.getOne(rlsContextFromPrincipal(principal), idOrCode);
  }

  @Post()
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Create a catalogue component under a service (audited).' })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateServiceComponentDto,
  ): Promise<ServiceComponentRecord> {
    return this.components.create(rlsContextFromPrincipal(principal), dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Update a catalogue component (audited).' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateServiceComponentDto,
  ): Promise<ServiceComponentRecord> {
    return this.components.update(rlsContextFromPrincipal(principal), id, dto);
  }
}
