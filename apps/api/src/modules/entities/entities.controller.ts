import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type BranchCandidate,
  type DuplicatePair,
  type MergeClientsResult,
  type MergePreview,
  type Paginated,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { EntitiesService } from './entities.service';
import { ClientMergeService } from './client-merge.service';
import { BranchesService } from './branches.service';
import { AddBranchDto, CombineBranchesDto, UpdateBranchDto } from './dto/branches.dto';
import { DismissDuplicateDto, MergeClientsDto } from './dto/merge-clients.dto';
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
  constructor(
    private readonly entities: EntitiesService,
    private readonly merges: ClientMergeService,
    private readonly branches: BranchesService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSION.entityRead)
  @ApiOperation({
    summary: 'List client entities (RLS-scoped, paginated)',
    description:
      'Firm-wide roles see all clients; office-scoped roles see their office. Filter by status/type/office, missing master data and free-text search; each row carries its missing items.',
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
    if (query.section?.length) filter.section = query.section;
    if (query.missing) filter.missing = query.missing;
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

  @Get('duplicates')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({
    summary: 'Clients that look like one entered twice',
    description:
      'Pairs of live clients the caller sees that share a PAN, GSTIN, TAN or CIN, or whose names agree once legal form and place are set aside. Pairs marked "not the same client" are left out.',
  })
  duplicates(@CurrentPrincipal() principal: Principal): Promise<DuplicatePair[]> {
    return this.merges.duplicates(rlsContextFromPrincipal(principal));
  }

  @Post('duplicates/dismiss')
  @HttpCode(204)
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Mark two clients as not the same client (audited)' })
  async dismissDuplicate(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: DismissDuplicateDto,
  ): Promise<void> {
    await this.merges.dismiss(rlsContextFromPrincipal(principal), dto.aId, dto.bId, dto.note);
  }

  @Get('branch-candidates')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({
    summary: 'Clients that should be one client with offices (CM-6)',
    description:
      'Live clients of one PAN registered in different states or named the same but for a place, and single clients with two or more GSTINs and no offices yet. Pairs marked "not offices of one business" are left out.',
  })
  branchCandidates(@CurrentPrincipal() principal: Principal): Promise<BranchCandidate[]> {
    return this.branches.candidates(rlsContextFromPrincipal(principal));
  }

  @Post('branch-candidates/dismiss')
  @HttpCode(204)
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Mark two clients as not offices of one business (audited)' })
  async dismissBranchCandidate(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: DismissDuplicateDto,
  ): Promise<void> {
    await this.branches.dismiss(rlsContextFromPrincipal(principal), dto.aId, dto.bId);
  }

  @Post(':id/combine-branches')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({
    summary: 'Combine clients of one PAN into this one, with offices (audited)',
    description:
      'Each other client is merged in; each GSTIN becomes an office; the kept client may take a new name. One transaction.',
  })
  combineBranches(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CombineBranchesDto,
  ): Promise<EntityDetail> {
    return this.branches.combine(rlsContextFromPrincipal(principal), id, dto);
  }

  @Post(':id/branches')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Add an office to a client (audited)' })
  addBranch(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddBranchDto,
  ): Promise<EntityDetail> {
    return this.branches.add(rlsContextFromPrincipal(principal), id, dto);
  }

  @Patch(':id/branches/:branchId')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Rename, make head office, close or reopen an office (audited)' })
  updateBranch(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() dto: UpdateBranchDto,
  ): Promise<EntityDetail> {
    return this.branches.update(rlsContextFromPrincipal(principal), id, branchId, dto);
  }

  @Get(':id/merge-preview')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({
    summary: 'What merging another client into this one would do',
    description:
      'Whether the two are one client and why, which to keep, the values they differ on, and what happens to each engagement of the one archived.',
  })
  mergePreview(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('with', new ParseUUIDPipe()) withId: string,
  ): Promise<MergePreview> {
    return this.merges.preview(rlsContextFromPrincipal(principal), id, withId);
  }

  @Post(':id/merge')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({
    summary: 'Merge another client into this one (audited)',
    description:
      'Registrations, contacts, logins, engagements and their billing move to this client; the other is archived and points here. Two different PANs are never merged.',
  })
  merge(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MergeClientsDto,
  ): Promise<MergeClientsResult> {
    return this.merges.merge(rlsContextFromPrincipal(principal), id, dto.dropId, dto.take);
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

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({
    summary: 'Delete a client entered by mistake (Managing Partner only; audited)',
    description:
      'Its registrations, contacts, logins and other master go with it. 409 while it has engagements, a place in another engagement, or billing — mark it inactive instead.',
  })
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.entities.deleteEntity(rlsContextFromPrincipal(principal), id);
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

  @Delete(':id/registrations/:registrationId')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({ summary: 'Remove a registration recorded in error (audited)' })
  removeRegistration(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('registrationId', new ParseUUIDPipe()) registrationId: string,
  ): Promise<EntityDetail> {
    return this.entities.removeRegistration(rlsContextFromPrincipal(principal), id, registrationId);
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
