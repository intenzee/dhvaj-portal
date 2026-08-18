import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type Paginated } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { CatalogueService } from './catalogue.service';
import type { ServiceDetail, ServiceFilter, ServiceSummary } from './catalogue.types';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ServiceListQueryDto } from './dto/service-list-query.dto';

@ApiTags('services')
@Controller('services')
export class ServicesController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Get()
  @RequirePermissions(PERMISSION.serviceRead)
  @ApiOperation({
    summary: 'List catalogue services (paginated)',
    description: 'Firm-wide config. Filter by service line, active flag, or free-text search.',
  })
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ServiceListQueryDto,
  ): Promise<Paginated<ServiceSummary>> {
    const filter: ServiceFilter = {};
    if (query.serviceLine) filter.serviceLineCode = query.serviceLine;
    if (query.active !== undefined) filter.active = query.active;
    if (query.search) filter.search = query.search;
    const result = await this.catalogue.listServices(
      rlsContextFromPrincipal(principal),
      filter,
      query,
    );
    return paginate(result, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.serviceRead)
  @ApiOperation({ summary: 'Get a service with its workflow states' })
  async getById(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ServiceDetail> {
    const service = await this.catalogue.getServiceById(rlsContextFromPrincipal(principal), id);
    if (!service) throw new NotFoundException('Service not found.');
    return service;
  }

  @Post()
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Create a service (audited)' })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateServiceDto,
  ): Promise<ServiceDetail> {
    return this.catalogue.createService(rlsContextFromPrincipal(principal), dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Update a service (audited; optimistic concurrency via version)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateServiceDto,
  ): Promise<ServiceDetail> {
    return this.catalogue.updateService(rlsContextFromPrincipal(principal), id, dto);
  }
}
