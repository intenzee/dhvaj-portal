import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
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
import { CatalogueService, OTHER_SERVICE_LINE_CODE } from './catalogue.service';
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
    this.assertOtherLineAuthorised(principal, dto.serviceLineCode);
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
    // A service under OTHER must always carry a recorded approval reference (§17).
    // The only way to satisfy that is the create path, so re-parenting an
    // existing service INTO the fallback line is not supported — this keeps the
    // invariant "every OTHER service was created with approval" unbreakable.
    if (dto.serviceLineCode === OTHER_SERVICE_LINE_CODE) {
      throw new BadRequestException(
        'A service cannot be moved into "Other Professional Services". Create it under ' +
          'that line instead, with an approval reference (spec §17).',
      );
    }
    return this.catalogue.updateService(rlsContextFromPrincipal(principal), id, dto);
  }

  /**
   * §17 control: the OTHER "Other Professional Services" line is a governed
   * fallback. Creating a service under it requires the dedicated
   * `service.manage_other` permission (held by the Managing Partner); the
   * recorded authorised-approval reference itself is enforced in the service
   * layer (and required by the DB write).
   */
  private assertOtherLineAuthorised(principal: Principal, serviceLineCode: string): void {
    if (serviceLineCode !== OTHER_SERVICE_LINE_CODE) return;
    if (!principal.permissions.includes(PERMISSION.serviceManageOther)) {
      throw new ForbiddenException(
        'Creating a service under "Other Professional Services" requires authorised ' +
          'catalogue approval (service.manage_other).',
      );
    }
  }
}
