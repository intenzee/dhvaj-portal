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
import { ClientsService } from './clients.service';
import type { ClientDetail, ClientFilter, ClientSummary } from './clients.types';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ClientListQueryDto } from './dto/client-list-query.dto';

@ApiTags('clients')
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @RequirePermissions(PERMISSION.entityRead)
  @ApiOperation({
    summary: 'List client relationships (RLS-scoped, paginated)',
    description: 'Firm-wide roles see all; office-scoped roles see their office. Filter/search.',
  })
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ClientListQueryDto,
  ): Promise<Paginated<ClientSummary>> {
    const filter: ClientFilter = {};
    if (query.status) filter.status = query.status;
    if (query.kind) filter.kind = query.kind;
    if (query.office) filter.officeCode = query.office;
    if (query.search) filter.search = query.search;
    const result = await this.clients.listClients(
      rlsContextFromPrincipal(principal),
      filter,
      query,
    );
    return paginate(result, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.entityRead)
  @ApiOperation({ summary: 'Get one client with its linked entities' })
  async getById(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ClientDetail> {
    const client = await this.clients.getClientById(rlsContextFromPrincipal(principal), id);
    if (!client) throw new NotFoundException('Client not found.');
    return client;
  }

  @Post()
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Create a client relationship (audited)' })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateClientDto,
  ): Promise<ClientDetail> {
    return this.clients.createClient(rlsContextFromPrincipal(principal), dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Update a client (audited; optimistic concurrency via version)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateClientDto,
  ): Promise<ClientDetail> {
    return this.clients.updateClient(rlsContextFromPrincipal(principal), id, dto);
  }
}
