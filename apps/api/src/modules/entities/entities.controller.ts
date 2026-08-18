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
import { EntitiesService } from './entities.service';
import type {
  DuplicateCandidate,
  EntityDetail,
  EntityFilter,
  EntitySummary,
} from './entities.types';
import { CreateEntityDto } from './dto/create-entity.dto';
import { UpdateEntityDto } from './dto/update-entity.dto';
import { EntityListQueryDto } from './dto/entity-list-query.dto';
import { RegistrationDto } from './dto/add-registration.dto';
import { ContactDto } from './dto/add-contact.dto';

@ApiTags('entities')
@Controller('entities')
export class EntitiesController {
  constructor(private readonly entities: EntitiesService) {}

  @Get()
  @RequirePermissions(PERMISSION.entityRead)
  @ApiOperation({
    summary: 'List client entities (RLS-scoped, paginated)',
    description:
      'Firm-wide roles see all clients; office-scoped roles see their office. Filter by status/type/office and free-text search.',
  })
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: EntityListQueryDto,
  ): Promise<Paginated<EntitySummary>> {
    const filter: EntityFilter = {};
    if (query.status) filter.status = query.status;
    if (query.type) filter.typeSlug = query.type;
    if (query.office) filter.officeCode = query.office;
    if (query.search) filter.search = query.search;
    const result = await this.entities.listEntities(
      rlsContextFromPrincipal(principal),
      filter,
      query,
    );
    return paginate(result, query);
  }

  @Get('duplicate-check')
  @RequirePermissions(PERMISSION.entityRead)
  @ApiOperation({
    summary: 'Find possible duplicate entities before creating one',
    description: 'Exact PAN match plus fuzzy legal-name matches (pg_trgm). Results are RLS-scoped.',
  })
  duplicateCheck(
    @CurrentPrincipal() principal: Principal,
    @Query('legalName') legalName?: string,
    @Query('pan') pan?: string,
  ): Promise<DuplicateCandidate[]> {
    return this.entities.checkDuplicates(rlsContextFromPrincipal(principal), {
      ...(legalName ? { legalName } : {}),
      ...(pan ? { pan: pan.toUpperCase() } : {}),
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.entityRead)
  @ApiOperation({
    summary: 'Get one entity with its registrations and contacts',
    description: '404 if outside the caller’s RLS scope (scope not leaked).',
  })
  async getById(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<EntityDetail> {
    const entity = await this.entities.getEntityById(rlsContextFromPrincipal(principal), id);
    if (!entity) throw new NotFoundException('Entity not found.');
    return entity;
  }

  @Post()
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Create a client entity with registrations/contacts (audited)' })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateEntityDto,
  ): Promise<EntityDetail> {
    return this.entities.createEntity(rlsContextFromPrincipal(principal), dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Update an entity (audited; optimistic concurrency via version)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateEntityDto,
  ): Promise<EntityDetail> {
    return this.entities.updateEntity(rlsContextFromPrincipal(principal), id, dto);
  }

  @Post(':id/registrations')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Add a statutory registration to an entity (audited)' })
  addRegistration(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RegistrationDto,
  ): Promise<EntityDetail> {
    return this.entities.addRegistration(rlsContextFromPrincipal(principal), id, dto);
  }

  @Post(':id/contacts')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Add a contact/signatory to an entity (audited)' })
  addContact(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ContactDto,
  ): Promise<EntityDetail> {
    return this.entities.addContact(rlsContextFromPrincipal(principal), id, dto);
  }
}
