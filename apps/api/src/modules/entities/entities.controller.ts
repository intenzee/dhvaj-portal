import {
  Body,
  Controller,
  Delete,
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
import { UpdateRegistrationDto } from './dto/update-registration.dto';
import { ContactDto } from './dto/add-contact.dto';
import { AddFinancialProfileDto } from './dto/add-financial-profile.dto';
import { AddressDto, UpdateAddressDto } from './dto/add-address.dto';
import { RelationshipDto, UpdateRelationshipDto } from './dto/add-relationship.dto';
import { BusinessActivityDto } from './dto/add-business-activity.dto';
import { ListingDto, UpdateListingDto } from './dto/add-listing.dto';
import { RegulatoryAttributeDto } from './dto/add-regulatory-attribute.dto';

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

  @Patch(':id/registrations/:registrationId')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({
    summary: 'Update a registration — the §34 "obtained later" flow (audited)',
    description:
      'Enter the issued number, effective dates and jurisdiction, flip Pending → Active; a complete regulatory profile is flagged Needs Reassessment.',
  })
  updateRegistration(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('registrationId', new ParseUUIDPipe()) registrationId: string,
    @Body() dto: UpdateRegistrationDto,
  ): Promise<EntityDetail> {
    return this.entities.updateRegistration(
      rlsContextFromPrincipal(principal),
      id,
      registrationId,
      dto,
    );
  }

  @Post(':id/registrations/:registrationId/verify')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Mark a registration Verified after review (§11, audited)' })
  verifyRegistration(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('registrationId', new ParseUUIDPipe()) registrationId: string,
  ): Promise<EntityDetail> {
    return this.entities.verifyRegistration(rlsContextFromPrincipal(principal), id, registrationId);
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

  @Post(':id/financial-profiles')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({
    summary: 'Record year-wise financial figures (§16, append-only, audited)',
    description:
      'Recording a year that already has a current figure set supersedes it; the prior figures are retained, never overwritten.',
  })
  addFinancialProfile(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddFinancialProfileDto,
  ): Promise<EntityDetail> {
    return this.entities.addFinancialProfile(rlsContextFromPrincipal(principal), id, dto);
  }

  // ── Addresses (§8/§31) ─────────────────────────────────────────────────────
  @Post(':id/addresses')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Add an address to an entity (audited)' })
  addAddress(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddressDto,
  ): Promise<EntityDetail> {
    return this.entities.addAddress(rlsContextFromPrincipal(principal), id, dto);
  }

  @Patch(':id/addresses/:childId')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Update an entity address (audited)' })
  updateAddress(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('childId', new ParseUUIDPipe()) childId: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<EntityDetail> {
    return this.entities.updateAddress(rlsContextFromPrincipal(principal), id, childId, dto);
  }

  @Delete(':id/addresses/:childId')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Remove an entity address (audited)' })
  removeAddress(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('childId', new ParseUUIDPipe()) childId: string,
  ): Promise<EntityDetail> {
    return this.entities.removeAddress(rlsContextFromPrincipal(principal), id, childId);
  }

  // ── Relationships (§13) ────────────────────────────────────────────────────
  @Post(':id/relationships')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({
    summary: 'Add an ownership/group relationship (audited)',
    description: 'Both endpoints must be within the caller’s scope (RLS-enforced).',
  })
  addRelationship(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RelationshipDto,
  ): Promise<EntityDetail> {
    return this.entities.addRelationship(rlsContextFromPrincipal(principal), id, dto);
  }

  @Patch(':id/relationships/:childId')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Update an ownership/group relationship (audited)' })
  updateRelationship(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('childId', new ParseUUIDPipe()) childId: string,
    @Body() dto: UpdateRelationshipDto,
  ): Promise<EntityDetail> {
    return this.entities.updateRelationship(rlsContextFromPrincipal(principal), id, childId, dto);
  }

  @Delete(':id/relationships/:childId')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Remove an ownership/group relationship (audited)' })
  removeRelationship(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('childId', new ParseUUIDPipe()) childId: string,
  ): Promise<EntityDetail> {
    return this.entities.removeRelationship(rlsContextFromPrincipal(principal), id, childId);
  }

  // ── Business activities (§18) ──────────────────────────────────────────────
  @Post(':id/business-activities')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Add an industry/NIC activity classification (audited)' })
  addBusinessActivity(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: BusinessActivityDto,
  ): Promise<EntityDetail> {
    return this.entities.addBusinessActivity(rlsContextFromPrincipal(principal), id, dto);
  }

  @Delete(':id/business-activities/:childId')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Remove an industry/NIC activity classification (audited)' })
  removeBusinessActivity(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('childId', new ParseUUIDPipe()) childId: string,
  ): Promise<EntityDetail> {
    return this.entities.removeBusinessActivity(rlsContextFromPrincipal(principal), id, childId);
  }

  // ── Listings (§15) ─────────────────────────────────────────────────────────
  @Post(':id/listings')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Add a listing line (exchange × security) (audited)' })
  addListing(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ListingDto,
  ): Promise<EntityDetail> {
    return this.entities.addListing(rlsContextFromPrincipal(principal), id, dto);
  }

  @Patch(':id/listings/:childId')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Update a listing line (audited)' })
  updateListing(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('childId', new ParseUUIDPipe()) childId: string,
    @Body() dto: UpdateListingDto,
  ): Promise<EntityDetail> {
    return this.entities.updateListing(rlsContextFromPrincipal(principal), id, childId, dto);
  }

  @Delete(':id/listings/:childId')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Remove a listing line (audited)' })
  removeListing(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('childId', new ParseUUIDPipe()) childId: string,
  ): Promise<EntityDetail> {
    return this.entities.removeListing(rlsContextFromPrincipal(principal), id, childId);
  }

  // ── Regulatory attributes (§19) ────────────────────────────────────────────
  @Post(':id/regulatory-attributes')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Record a structured regulatory fact — never a conclusion (audited)' })
  addRegulatoryAttribute(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RegulatoryAttributeDto,
  ): Promise<EntityDetail> {
    return this.entities.addRegulatoryAttribute(rlsContextFromPrincipal(principal), id, dto);
  }

  @Delete(':id/regulatory-attributes/:childId')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Remove a structured regulatory fact (audited)' })
  removeRegulatoryAttribute(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('childId', new ParseUUIDPipe()) childId: string,
  ): Promise<EntityDetail> {
    return this.entities.removeRegulatoryAttribute(rlsContextFromPrincipal(principal), id, childId);
  }
}
