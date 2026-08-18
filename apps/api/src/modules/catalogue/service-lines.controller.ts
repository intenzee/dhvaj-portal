import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { CatalogueService } from './catalogue.service';
import type { ServiceLineRecord } from './catalogue.types';
import { CreateServiceLineDto, UpdateServiceLineDto } from './dto/service-line.dto';

@ApiTags('service-lines')
@Controller('service-lines')
export class ServiceLinesController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Get()
  @RequirePermissions(PERMISSION.serviceRead)
  @ApiOperation({ summary: 'List service lines' })
  list(@CurrentPrincipal() principal: Principal): Promise<ServiceLineRecord[]> {
    return this.catalogue.listServiceLines(rlsContextFromPrincipal(principal));
  }

  @Post()
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Create a service line (audited)' })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateServiceLineDto,
  ): Promise<ServiceLineRecord> {
    return this.catalogue.createServiceLine(rlsContextFromPrincipal(principal), dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Update a service line (audited; optimistic concurrency via version)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateServiceLineDto,
  ): Promise<ServiceLineRecord> {
    return this.catalogue.updateServiceLine(rlsContextFromPrincipal(principal), id, dto);
  }
}
